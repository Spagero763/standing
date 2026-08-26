import { expect } from 'chai'
import { ethers } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { CreditLine, CreditRegistry, TestUSD } from '../typechain-types'
import {
  AMOUNT_WORD,
  BORROWER_TOPIC,
  CHAIN_KEY,
  EMPTY_CONTINUITY,
  EMPTY_MERKLE,
  REPAY_TOPIC,
  encodeTx,
  installVerifier,
  repayLog
} from './helpers'

const POOL = '0xAAAA000000000000000000000000000000000001'
const CEILING = 1_000_000n
const RATE_BPS = 500n
const TERM = 30n * 24n * 60n * 60n

describe('CreditLine', () => {
  let line: CreditLine
  let registry: CreditRegistry
  let usd: TestUSD
  let owner: HardhatEthersSigner
  let alice: HardhatEthersSigner
  let stranger: HardhatEthersSigner

  /** Gives a borrower a real record by proving repayments through the registry. */
  async function buildHistory(who: HardhatEthersSigner, count: number, startHeight = 1000n) {
    for (let i = 0; i < count; i++) {
      const encoded = encodeTx({
        from: who.address,
        to: POOL,
        logs: [repayLog(POOL, who.address, 100_000n)]
      })
      await registry
        .connect(who)
        .recordRepayment(
          CHAIN_KEY, startHeight + BigInt(i), encoded, EMPTY_MERKLE, EMPTY_CONTINUITY, 0n
        )
    }
  }

  beforeEach(async () => {
    ;[owner, alice, stranger] = await ethers.getSigners()

    await installVerifier('AlwaysVerify')

    registry = await ethers.deployContract('CreditRegistry', [owner.address])
    await registry.setMarket(CHAIN_KEY, POOL, REPAY_TOPIC, BORROWER_TOPIC, AMOUNT_WORD, 'Aave V3')

    usd = await ethers.deployContract('TestUSD')
    line = await ethers.deployContract('CreditLine', [
      owner.address,
      await usd.getAddress(),
      await registry.getAddress()
    ])

    await usd.mint(owner.address, 10_000_000n)
    await usd.approve(await line.getAddress(), 10_000_000n)
    await line.fund(5_000_000n)
  })

  it('offers nothing to a wallet with no proven history', async () => {
    expect(await registry.scoreOf(stranger.address)).to.equal(0n)
    expect(await line.limitOf(stranger.address)).to.equal(0n)

    await expect(line.connect(stranger).draw(1n)).to.be.revertedWithCustomError(
      line, 'NoCreditAvailable'
    )
  })

  it('sizes the limit from the proven score', async () => {
    await buildHistory(alice, 3)

    const score = await registry.scoreOf(alice.address)
    expect(score).to.be.greaterThan(0n)
    expect(await line.limitOf(alice.address)).to.equal((CEILING * score) / 1000n)
  })

  it('lends with no collateral posted', async () => {
    await buildHistory(alice, 3)
    const limit = await line.limitOf(alice.address)

    const before = await usd.balanceOf(alice.address)
    await line.connect(alice).draw(limit)
    const after = await usd.balanceOf(alice.address)

    expect(after - before).to.equal(limit)
    expect(await line.owedBy(alice.address)).to.equal(limit)
  })

  it('refuses to lend past the limit', async () => {
    await buildHistory(alice, 3)
    const limit = await line.limitOf(alice.address)

    await expect(line.connect(alice).draw(limit + 1n)).to.be.revertedWithCustomError(
      line, 'ExceedsLimit'
    )
  })

  it('refuses to lend more than the pool holds', async () => {
    await buildHistory(alice, 20)
    await line.setTerms(100_000_000n, Number(RATE_BPS), Number(TERM))

    await expect(line.connect(alice).draw(6_000_000n)).to.be.revertedWithCustomError(
      line, 'InsufficientLiquidity'
    )
  })

  it('accrues interest over time', async () => {
    await buildHistory(alice, 3)
    const drawn = await line.limitOf(alice.address)
    await line.connect(alice).draw(drawn)

    await time.increase(365 * 24 * 60 * 60)

    const owed = await line.owedBy(alice.address)
    const expected = drawn + (drawn * RATE_BPS) / 10_000n
    expect(owed).to.be.closeTo(expected, expected / 1000n)
  })

  it('clears the debt when fully repaid', async () => {
    await buildHistory(alice, 3)
    const drawn = await line.limitOf(alice.address)
    await line.connect(alice).draw(drawn)

    await time.increase(7 * 24 * 60 * 60)

    const owed = await line.owedBy(alice.address)
    await usd.mint(alice.address, owed)
    await usd.connect(alice).approve(await line.getAddress(), owed * 2n)
    await line.connect(alice).repay(owed * 2n)

    expect(await line.owedBy(alice.address)).to.equal(0n)
    const loan = await line.loanOf(alice.address)
    expect(loan.principal).to.equal(0n)
    expect(loan.dueAt).to.equal(0n)
  })

  it('never takes more than is owed', async () => {
    await buildHistory(alice, 3)
    const drawn = await line.limitOf(alice.address)
    await line.connect(alice).draw(drawn)

    const owed = await line.owedBy(alice.address)
    await usd.mint(alice.address, owed * 5n)
    await usd.connect(alice).approve(await line.getAddress(), owed * 5n)

    const before = await usd.balanceOf(alice.address)
    await line.connect(alice).repay(owed * 5n)
    const spent = before - (await usd.balanceOf(alice.address))

    expect(spent).to.be.closeTo(owed, owed / 1000n)
  })

  it('freezes the line once a loan runs past its term', async () => {
    await buildHistory(alice, 3)
    const limit = await line.limitOf(alice.address)
    await line.connect(alice).draw(limit / 2n)

    await time.increase(Number(TERM) + 1)

    expect(await line.limitOf(alice.address)).to.equal(0n)
    await expect(line.connect(alice).draw(1n)).to.be.revertedWithCustomError(line, 'Overdue')
  })

  it('restores the line after an overdue loan is settled', async () => {
    await buildHistory(alice, 3)
    const limit = await line.limitOf(alice.address)
    await line.connect(alice).draw(limit / 2n)

    await time.increase(Number(TERM) + 1)
    expect(await line.limitOf(alice.address)).to.equal(0n)

    const owed = await line.owedBy(alice.address)
    await usd.mint(alice.address, owed)
    await usd.connect(alice).approve(await line.getAddress(), owed)
    await line.connect(alice).repay(owed)

    expect(await line.limitOf(alice.address)).to.equal(limit)
  })

  it('stops lending when paused', async () => {
    await buildHistory(alice, 3)
    await line.setPaused(true)

    await expect(line.connect(alice).draw(1n)).to.be.revertedWithCustomError(line, 'EnforcedPause')

    // Repaying stays open while paused, so nobody is trapped in a loan.
    await line.setPaused(false)
    await line.connect(alice).draw(1000n)
    await line.setPaused(true)

    await usd.connect(alice).approve(await line.getAddress(), 1000n)
    await expect(line.connect(alice).repay(1000n)).to.not.be.reverted
  })

  it('only the owner can change the terms or move liquidity', async () => {
    await expect(
      line.connect(stranger).setTerms(1n, 1, 1)
    ).to.be.revertedWithCustomError(line, 'OwnableUnauthorizedAccount')

    await expect(
      line.connect(stranger).withdraw(stranger.address, 1n)
    ).to.be.revertedWithCustomError(line, 'OwnableUnauthorizedAccount')
  })

  it('rejects absurd terms', async () => {
    await expect(line.setTerms(1n, 6000, Number(TERM))).to.be.revertedWithCustomError(
      line, 'BadTerms'
    )
    await expect(line.setTerms(1n, 100, 0)).to.be.revertedWithCustomError(line, 'BadTerms')
  })

  it('grows the limit as the borrower proves more', async () => {
    await buildHistory(alice, 2, 1000n)
    const early = await line.limitOf(alice.address)

    await buildHistory(alice, 4, 5000n)
    const later = await line.limitOf(alice.address)

    expect(later).to.be.greaterThan(early)
  })
})
