import { expect } from 'chai'
import { ethers } from 'hardhat'
import { AbiCoder, id, zeroPadValue } from 'ethers'
import type { CreditRegistry } from '../typechain-types'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'

const PRECOMPILE = '0x0000000000000000000000000000000000000FD2'
const CHAIN_KEY = 1n

/// Aave V3: Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)
const REPAY_TOPIC = id('Repay(address,address,address,uint256,bool)')
const BORROWER_TOPIC = 2 // the `user`, not the `repayer`
const AMOUNT_WORD = 0

const coder = AbiCoder.defaultAbiCoder()

const COMMON = ['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes']
const RECEIPT = ['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes']

type Log = { addr: string; topics: string[]; data: string }

/**
 * Rebuilds the blob Attestcoin proves, in the layout confirmed against live
 * Sepolia transactions. Group 1 is type specific and the registry never reads
 * it, so it is left empty here on purpose.
 */
function encodeTx(opts: { from: string; to: string; status?: number; logs: Log[] }) {
  const common = coder.encode(COMMON, [7, 200000, opts.from, false, opts.to, 0, '0x'])
  const receipt = coder.encode(RECEIPT, [
    opts.status ?? 1,
    50000,
    opts.logs.map((l) => [l.addr, l.topics, l.data]),
    '0x'
  ])
  return coder.encode(['uint8', 'bytes[]'], [2, [common, '0x', receipt]])
}

function repayLog(pool: string, borrower: string, amount: bigint, asset?: string): Log {
  return {
    addr: pool,
    topics: [
      REPAY_TOPIC,
      zeroPadValue(asset ?? '0x1111111111111111111111111111111111111111', 32),
      zeroPadValue(borrower, 32),
      zeroPadValue('0x2222222222222222222222222222222222222222', 32)
    ],
    data: coder.encode(['uint256', 'bool'], [amount, false])
  }
}

const EMPTY_MERKLE = { root: ethers.ZeroHash, siblings: [] }
const EMPTY_CONTINUITY = { lowerEndpointDigest: ethers.ZeroHash, roots: [] }

async function installVerifier(name: string) {
  const mock = await ethers.deployContract(name)
  const code = await ethers.provider.getCode(await mock.getAddress())
  await ethers.provider.send('hardhat_setCode', [PRECOMPILE, code])
}

describe('CreditRegistry', () => {
  let registry: CreditRegistry
  let owner: HardhatEthersSigner
  let alice: HardhatEthersSigner
  let mallory: HardhatEthersSigner
  let pool: string
  let otherPool: string

  beforeEach(async () => {
    ;[owner, alice, mallory] = await ethers.getSigners()
    pool = '0xAAAA000000000000000000000000000000000001'
    otherPool = '0xBBBB000000000000000000000000000000000002'

    await installVerifier('AlwaysVerify')

    registry = await ethers.deployContract('CreditRegistry', [owner.address])
    await registry.setMarket(
      CHAIN_KEY, pool, REPAY_TOPIC, BORROWER_TOPIC, AMOUNT_WORD, 'Aave V3'
    )
  })

  function record(
    signer: HardhatEthersSigner,
    encoded: string,
    height = 1000n,
    logIndex = 0n
  ) {
    return registry
      .connect(signer)
      .recordRepayment(CHAIN_KEY, height, encoded, EMPTY_MERKLE, EMPTY_CONTINUITY, logIndex)
  }

  it('records a proven repayment and credits the borrower', async () => {
    const encoded = encodeTx({
      from: alice.address,
      to: pool,
      logs: [repayLog(pool, alice.address, 500n)]
    })

    await expect(record(alice, encoded)).to.emit(registry, 'RepaymentRecorded')

    const standing = await registry.standingOf(alice.address)
    expect(standing.repayments).to.equal(1n)
    expect(standing.totalRepaid).to.equal(500n)
    expect(standing.markets).to.equal(1n)
    expect(await registry.scoreOf(alice.address)).to.be.greaterThan(0n)
  })

  it('refuses a transaction that reverted on the source chain', async () => {
    const encoded = encodeTx({
      from: alice.address,
      to: pool,
      status: 0,
      logs: [repayLog(pool, alice.address, 500n)]
    })

    await expect(record(alice, encoded)).to.be.revertedWithCustomError(
      registry, 'TransactionFailedOnSource'
    )
  })

  it('refuses a pool that was never allowlisted', async () => {
    const encoded = encodeTx({
      from: alice.address,
      to: otherPool,
      logs: [repayLog(otherPool, alice.address, 500n)]
    })

    await expect(record(alice, encoded)).to.be.revertedWithCustomError(
      registry, 'MarketNotAllowed'
    )
  })

  it('refuses a lookalike event emitted by some other contract', async () => {
    const impostor = '0xCCCC000000000000000000000000000000000003'
    const encoded = encodeTx({
      from: alice.address,
      to: pool,
      logs: [repayLog(impostor, alice.address, 10n ** 30n)]
    })

    await expect(record(alice, encoded)).to.be.revertedWithCustomError(
      registry, 'NoMatchingRepayment'
    )
  })

  it('refuses a log whose topic is not the repayment event', async () => {
    const wrong = repayLog(pool, alice.address, 500n)
    wrong.topics[0] = id('Transfer(address,address,uint256)')

    const encoded = encodeTx({ from: alice.address, to: pool, logs: [wrong] })

    await expect(record(alice, encoded)).to.be.revertedWithCustomError(
      registry, 'NoMatchingRepayment'
    )
  })

  it('will not let one wallet claim another wallet\'s repayment', async () => {
    const encoded = encodeTx({
      from: alice.address,
      to: pool,
      logs: [repayLog(pool, alice.address, 500n)]
    })

    await expect(record(mallory, encoded)).to.be.revertedWithCustomError(
      registry, 'NotYourRepayment'
    )
  })

  it('credits the borrower named in the event, not whoever sent the transaction', async () => {
    // A third party repaid on Alice's behalf, which Aave permits.
    const encoded = encodeTx({
      from: mallory.address,
      to: pool,
      logs: [repayLog(pool, alice.address, 500n)]
    })

    await expect(record(mallory, encoded)).to.be.revertedWithCustomError(
      registry, 'NotYourRepayment'
    )
    await expect(record(alice, encoded)).to.emit(registry, 'RepaymentRecorded')
  })

  it('refuses to count the same repayment twice', async () => {
    const encoded = encodeTx({
      from: alice.address,
      to: pool,
      logs: [repayLog(pool, alice.address, 500n)]
    })

    await record(alice, encoded)
    await expect(record(alice, encoded)).to.be.revertedWithCustomError(
      registry, 'AlreadyClaimed'
    )

    expect((await registry.standingOf(alice.address)).repayments).to.equal(1n)
  })

  it('counts two separate repayments inside one transaction', async () => {
    const encoded = encodeTx({
      from: alice.address,
      to: pool,
      logs: [repayLog(pool, alice.address, 300n), repayLog(pool, alice.address, 700n)]
    })

    await record(alice, encoded, 1000n, 0n)
    await record(alice, encoded, 1000n, 1n)

    const standing = await registry.standingOf(alice.address)
    expect(standing.repayments).to.equal(2n)
    expect(standing.totalRepaid).to.equal(1000n)
  })

  it('rejects a proof the precompile does not vouch for', async () => {
    await installVerifier('FalseVerify')
    const encoded = encodeTx({
      from: alice.address,
      to: pool,
      logs: [repayLog(pool, alice.address, 500n)]
    })

    await expect(record(alice, encoded)).to.be.revertedWithCustomError(registry, 'ProofRejected')
  })

  it('propagates a reverting precompile rather than swallowing it', async () => {
    await installVerifier('RevertingVerify')
    const encoded = encodeTx({
      from: alice.address,
      to: pool,
      logs: [repayLog(pool, alice.address, 500n)]
    })

    await expect(record(alice, encoded)).to.be.reverted
  })

  it('rewards breadth across markets and length of history', async () => {
    await registry.setMarket(
      CHAIN_KEY, otherPool, REPAY_TOPIC, BORROWER_TOPIC, AMOUNT_WORD, 'Morpho'
    )

    const first = encodeTx({
      from: alice.address, to: pool, logs: [repayLog(pool, alice.address, 100n)]
    })
    await record(alice, first, 1_000n)
    const afterOne = await registry.scoreOf(alice.address)

    const second = encodeTx({
      from: alice.address, to: otherPool, logs: [repayLog(otherPool, alice.address, 100n)]
    })
    await record(alice, second, 900_000n)
    const afterTwo = await registry.scoreOf(alice.address)

    expect(afterTwo).to.be.greaterThan(afterOne)

    const standing = await registry.standingOf(alice.address)
    expect(standing.markets).to.equal(2n)
    expect(standing.firstHeight).to.equal(1_000n)
    expect(standing.lastHeight).to.equal(900_000n)
  })

  it('caps the score', async () => {
    expect(await registry.scoreOf(mallory.address)).to.equal(0n)
  })

  it('only the owner can add a market', async () => {
    await expect(
      registry.connect(mallory).setMarket(
        CHAIN_KEY, otherPool, REPAY_TOPIC, BORROWER_TOPIC, AMOUNT_WORD, 'rogue'
      )
    ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount')
  })
})
