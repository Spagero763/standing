import { expect } from 'chai'
import { ethers } from 'hardhat'
import { AbiCoder, id } from 'ethers'
import type { ContractTransactionReceipt } from 'ethers'

const PRECOMPILE = '0x0000000000000000000000000000000000000FD2'
const CHAIN_KEY = 1n
const REPAY_TOPIC = id('Repay(address,address,address,uint256,bool)')

const coder = AbiCoder.defaultAbiCoder()
const COMMON = ['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes']
const RECEIPT = ['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes']

/** Packs a real receipt into the layout Attestcoin attests. */
function encodeFromReceipt(from: string, to: string, receipt: ContractTransactionReceipt) {
  const common = coder.encode(COMMON, [1, 500000, from, false, to, 0, '0x'])
  const logs = receipt.logs.map((l) => [l.address, [...l.topics], l.data])
  const encodedReceipt = coder.encode(RECEIPT, [receipt.status ?? 1, receipt.gasUsed, logs, '0x'])
  return coder.encode(['uint8', 'bytes[]'], [2, [common, '0x', encodedReceipt]])
}

const EMPTY_MERKLE = { root: ethers.ZeroHash, siblings: [] }
const EMPTY_CONTINUITY = { lowerEndpointDigest: ethers.ZeroHash, roots: [] }

describe('end to end against a real pool event', () => {
  it('reads a genuine Repay log and credits the borrower', async () => {
    const [deployer, alice] = await ethers.getSigners()

    // --- source chain ---
    const usd = await ethers.deployContract('TestUSD')
    const pool = await ethers.deployContract('DemoLendingPool')
    const poolAddress = await pool.getAddress()
    const usdAddress = await usd.getAddress()

    await usd.mint(poolAddress, 1_000_000n)
    await usd.mint(alice.address, 1_000_000n)

    await pool.connect(alice).borrow(usdAddress, 250_000n)
    await usd.connect(alice).approve(poolAddress, 250_000n)

    const repayTx = await pool.connect(alice).repay(usdAddress, 250_000n, alice.address)
    const receipt = (await repayTx.wait())!

    const repayIndex = receipt.logs.findIndex(
      (l) => l.address.toLowerCase() === poolAddress.toLowerCase() && l.topics[0] === REPAY_TOPIC
    )
    expect(repayIndex, 'pool emitted a Repay log').to.be.greaterThanOrEqual(0)

    // --- creditcoin side ---
    const mock = await ethers.deployContract('AlwaysVerify')
    await ethers.provider.send('hardhat_setCode', [
      PRECOMPILE,
      await ethers.provider.getCode(await mock.getAddress())
    ])

    const registry = await ethers.deployContract('CreditRegistry', [deployer.address])
    await registry.setMarket(CHAIN_KEY, poolAddress, REPAY_TOPIC, 2, 0, 'Demo Pool')

    const encoded = encodeFromReceipt(alice.address, poolAddress, receipt)

    await expect(
      registry
        .connect(alice)
        .recordRepayment(
          CHAIN_KEY, 4242n, encoded, EMPTY_MERKLE, EMPTY_CONTINUITY, BigInt(repayIndex)
        )
    ).to.emit(registry, 'RepaymentRecorded')

    const standing = await registry.standingOf(alice.address)
    expect(standing.repayments).to.equal(1n)
    expect(standing.totalRepaid, 'amount decoded straight out of the real log').to.equal(250_000n)
  })

  it('credits the borrower when someone else settles their debt', async () => {
    const [deployer, alice, mallory] = await ethers.getSigners()

    const usd = await ethers.deployContract('TestUSD')
    const pool = await ethers.deployContract('DemoLendingPool')
    const poolAddress = await pool.getAddress()
    const usdAddress = await usd.getAddress()

    await usd.mint(poolAddress, 1_000_000n)
    await usd.mint(mallory.address, 1_000_000n)

    await pool.connect(alice).borrow(usdAddress, 100_000n)
    await usd.connect(mallory).approve(poolAddress, 100_000n)

    // Mallory pays off Alice's loan.
    const repayTx = await pool.connect(mallory).repay(usdAddress, 100_000n, alice.address)
    const receipt = (await repayTx.wait())!
    const repayIndex = receipt.logs.findIndex(
      (l) => l.address.toLowerCase() === poolAddress.toLowerCase() && l.topics[0] === REPAY_TOPIC
    )

    const mock = await ethers.deployContract('AlwaysVerify')
    await ethers.provider.send('hardhat_setCode', [
      PRECOMPILE,
      await ethers.provider.getCode(await mock.getAddress())
    ])

    const registry = await ethers.deployContract('CreditRegistry', [deployer.address])
    await registry.setMarket(CHAIN_KEY, poolAddress, REPAY_TOPIC, 2, 0, 'Demo Pool')

    const encoded = encodeFromReceipt(mallory.address, poolAddress, receipt)
    const call = (who: typeof alice) =>
      registry
        .connect(who)
        .recordRepayment(
          CHAIN_KEY, 4242n, encoded, EMPTY_MERKLE, EMPTY_CONTINUITY, BigInt(repayIndex)
        )

    // Mallory sent the transaction but the debt was Alice's.
    await expect(call(mallory)).to.be.revertedWithCustomError(registry, 'NotYourRepayment')
    await expect(call(alice)).to.emit(registry, 'RepaymentRecorded')

    expect((await registry.standingOf(alice.address)).repayments).to.equal(1n)
    expect((await registry.standingOf(mallory.address)).repayments).to.equal(0n)
  })
})
