import { ethers, network } from 'hardhat'
import { id } from 'ethers'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const REPAY_TOPIC = id('Repay(address,address,address,uint256,bool)')

async function main() {
  const proof = JSON.parse(readFileSync(join(ROOT, 'proof-batch.json'), 'utf8'))
  const deployments = JSON.parse(readFileSync(join(ROOT, 'deployments.json'), 'utf8'))

  const registryAddress = deployments[network.name]?.CreditRegistry
  const pool = deployments.sepolia?.AaveV3Pool
  if (!registryAddress || !pool) throw new Error('missing deployment records')

  const [signer] = await ethers.getSigners()
  const registry = await ethers.getContractAt('CreditRegistry', registryAddress, signer)

  console.log(`registry ${registryAddress}`)
  console.log(`market   Aave V3 at ${pool}`)
  console.log(`proving  ${proof.heights.length} repayments in one transaction\n`)

  const market = await registry.markets(proof.chainKey, pool)
  if (!market.enabled) {
    const tx = await registry.setMarket(proof.chainKey, pool, REPAY_TOPIC, 2, 0, 'Aave V3')
    await tx.wait()
    console.log(`registered market  ${tx.hash}`)
  }

  const before = await registry.scoreOf(signer.address)

  const tx = await registry.recordRepayments(
    proof.chainKey,
    proof.heights,
    proof.txBytes,
    proof.merkleProofs,
    proof.continuityProof,
    proof.logIndexes
  )
  console.log(`\nbatch tx ${tx.hash}`)
  const rcpt = await tx.wait()
  console.log(`  block ${rcpt?.blockNumber}`)
  console.log(`  gas   ${rcpt?.gasUsed} for ${proof.heights.length} repayments`)
  console.log(`  per   ${(rcpt!.gasUsed / BigInt(proof.heights.length)).toString()} each`)

  const standing = await registry.standingOf(signer.address)
  const after = await registry.scoreOf(signer.address)

  console.log('\n--- standing ---')
  console.log(`  repayments  ${standing.repayments}`)
  console.log(`  totalRepaid ${standing.totalRepaid}`)
  console.log(`  markets     ${standing.markets}`)
  console.log(`  blocks      ${standing.firstHeight} to ${standing.lastHeight}`)
  console.log(`  score       ${before} -> ${after}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
