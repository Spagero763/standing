import { expect } from 'chai'
import { ethers } from 'hardhat'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { CreditRegistry } from '../typechain-types'
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
const OTHER = '0xBBBB000000000000000000000000000000000002'

describe('recording a history in one transaction', () => {
  let registry: CreditRegistry
  let owner: HardhatEthersSigner
  let alice: HardhatEthersSigner
  let mallory: HardhatEthersSigner

  beforeEach(async () => {
    ;[owner, alice, mallory] = await ethers.getSigners()
    await installVerifier('AlwaysVerify')

    registry = await ethers.deployContract('CreditRegistry', [owner.address])
    await registry.setMarket(CHAIN_KEY, POOL, REPAY_TOPIC, BORROWER_TOPIC, AMOUNT_WORD, 'Aave V3')
    await registry.setMarket(CHAIN_KEY, OTHER, REPAY_TOPIC, BORROWER_TOPIC, AMOUNT_WORD, 'Morpho')
  })

  function history(who: string, amounts: bigint[], pool = POOL) {
    const heights = amounts.map((_, i) => 1_000n + BigInt(i) * 100n)
    const encoded = amounts.map((a) => encodeTx({ from: who, to: pool, logs: [repayLog(pool, who, a)] }))
    return {
      heights,
      encoded,
      merkle: amounts.map(() => EMPTY_MERKLE),
      logIndexes: amounts.map(() => 0n)
    }
  }

  it('settles several repayments at once', async () => {
    const amounts = [100n, 250n, 400n, 50n]
    const h = history(alice.address, amounts)

    await expect(
      registry
        .connect(alice)
        .recordRepayments(CHAIN_KEY, h.heights, h.encoded, h.merkle, EMPTY_CONTINUITY, h.logIndexes)
    ).to.emit(registry, 'RepaymentRecorded')

    const standing = await registry.standingOf(alice.address)
    expect(standing.repayments).to.equal(BigInt(amounts.length))
    expect(standing.totalRepaid).to.equal(amounts.reduce((a, b) => a + b, 0n))
    expect(standing.firstHeight).to.equal(1_000n)
    expect(standing.lastHeight).to.equal(1_300n)
  })

  it('lands on the same standing as recording them one by one', async () => {
    const amounts = [100n, 250n, 400n]

    const batched = history(alice.address, amounts)
    await registry
      .connect(alice)
      .recordRepayments(
        CHAIN_KEY, batched.heights, batched.encoded, batched.merkle, EMPTY_CONTINUITY, batched.logIndexes
      )
    const viaBatch = await registry.standingOf(alice.address)

    // Same history, different wallet, recorded individually.
    const single = history(mallory.address, amounts)
    for (let i = 0; i < amounts.length; i++) {
      await registry
        .connect(mallory)
        .recordRepayment(
          CHAIN_KEY, single.heights[i], single.encoded[i], EMPTY_MERKLE, EMPTY_CONTINUITY, 0n
        )
    }
    const viaSingle = await registry.standingOf(mallory.address)

    expect(viaBatch.repayments).to.equal(viaSingle.repayments)
    expect(viaBatch.totalRepaid).to.equal(viaSingle.totalRepaid)
    expect(viaBatch.markets).to.equal(viaSingle.markets)
    expect(await registry.scoreOf(alice.address)).to.equal(await registry.scoreOf(mallory.address))
  })

  it('costs less gas than the same history one at a time', async () => {
    const amounts = [100n, 250n, 400n, 50n, 75n]

    const batched = history(alice.address, amounts)
    const batchTx = await registry
      .connect(alice)
      .recordRepayments(
        CHAIN_KEY, batched.heights, batched.encoded, batched.merkle, EMPTY_CONTINUITY, batched.logIndexes
      )
    const batchGas = (await batchTx.wait())!.gasUsed

    const single = history(mallory.address, amounts)
    let singleGas = 0n
    for (let i = 0; i < amounts.length; i++) {
      const tx = await registry
        .connect(mallory)
        .recordRepayment(
          CHAIN_KEY, single.heights[i], single.encoded[i], EMPTY_MERKLE, EMPTY_CONTINUITY, 0n
        )
      singleGas += (await tx.wait())!.gasUsed
    }

    console.log(`        batch ${batchGas}  individually ${singleGas}`)
    expect(batchGas).to.be.lessThan(singleGas)
  })

  it('counts distinct markets across the batch', async () => {
    const a = history(alice.address, [100n, 200n], POOL)
    const b = history(alice.address, [300n], OTHER)

    await registry.connect(alice).recordRepayments(
      CHAIN_KEY,
      [...a.heights, 5_000n],
      [...a.encoded, ...b.encoded],
      [...a.merkle, EMPTY_MERKLE],
      EMPTY_CONTINUITY,
      [...a.logIndexes, 0n]
    )

    const standing = await registry.standingOf(alice.address)
    expect(standing.repayments).to.equal(3n)
    expect(standing.markets).to.equal(2n)
  })

  it('rejects mismatched array lengths', async () => {
    const h = history(alice.address, [100n, 200n])

    await expect(
      registry
        .connect(alice)
        .recordRepayments(CHAIN_KEY, h.heights, [h.encoded[0]], h.merkle, EMPTY_CONTINUITY, h.logIndexes)
    ).to.be.revertedWithCustomError(registry, 'LengthMismatch')
  })

  it('rejects an empty batch', async () => {
    await expect(
      registry.connect(alice).recordRepayments(CHAIN_KEY, [], [], [], EMPTY_CONTINUITY, [])
    ).to.be.revertedWithCustomError(registry, 'NothingToRecord')
  })

  it('refuses the whole batch if one entry is not yours', async () => {
    const mine = history(alice.address, [100n])
    const theirs = history(mallory.address, [999n])

    await expect(
      registry.connect(alice).recordRepayments(
        CHAIN_KEY,
        [...mine.heights, 7_000n],
        [...mine.encoded, ...theirs.encoded],
        [...mine.merkle, EMPTY_MERKLE],
        EMPTY_CONTINUITY,
        [...mine.logIndexes, 0n]
      )
    ).to.be.revertedWithCustomError(registry, 'NotYourRepayment')

    // Nothing was written, not even the entry that would have passed.
    expect((await registry.standingOf(alice.address)).repayments).to.equal(0n)
  })

  it('refuses a batch that claims the same repayment twice', async () => {
    const h = history(alice.address, [100n])

    await expect(
      registry.connect(alice).recordRepayments(
        CHAIN_KEY,
        [h.heights[0], h.heights[0]],
        [h.encoded[0], h.encoded[0]],
        [EMPTY_MERKLE, EMPTY_MERKLE],
        EMPTY_CONTINUITY,
        [0n, 0n]
      )
    ).to.be.revertedWithCustomError(registry, 'AlreadyClaimed')
  })

  it('refuses a batch already recorded singly', async () => {
    const h = history(alice.address, [100n])

    await registry
      .connect(alice)
      .recordRepayment(CHAIN_KEY, h.heights[0], h.encoded[0], EMPTY_MERKLE, EMPTY_CONTINUITY, 0n)

    await expect(
      registry
        .connect(alice)
        .recordRepayments(CHAIN_KEY, h.heights, h.encoded, h.merkle, EMPTY_CONTINUITY, h.logIndexes)
    ).to.be.revertedWithCustomError(registry, 'AlreadyClaimed')
  })

  it('rejects the batch when the precompile does not vouch for it', async () => {
    await installVerifier('FalseVerify')
    const h = history(alice.address, [100n, 200n])

    await expect(
      registry
        .connect(alice)
        .recordRepayments(CHAIN_KEY, h.heights, h.encoded, h.merkle, EMPTY_CONTINUITY, h.logIndexes)
    ).to.be.revertedWithCustomError(registry, 'ProofRejected')
  })
})
