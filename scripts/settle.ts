import { ethers, network } from 'hardhat'
import { AbiCoder, id } from 'ethers'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

// Aave signals a repayment with Repay(...). Compound signals it with Supply(...).
// The registry does not care which, so long as the market says which to look for.
const REPAY_TOPIC = process.env.MARKET_TOPIC ?? id('Repay(address,address,address,uint256,bool)')

const coder = AbiCoder.defaultAbiCoder()
const COMMON = ['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes']
const RECEIPT = ['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes']

async function main() {
  // Defaults settle our own pool. Point these at the Aave run to settle that instead.
  const proofFile = process.env.PROOF_FILE ?? 'proof.json'
  const poolKey = process.env.POOL_KEY ?? 'DemoLendingPool'
  const marketName = process.env.MARKET_NAME ?? 'Demo Pool'

  const proof = JSON.parse(readFileSync(join(ROOT, proofFile), 'utf8'))
  const deployments = JSON.parse(readFileSync(join(ROOT, 'deployments.json'), 'utf8'))

  const registryAddress = deployments[network.name]?.CreditRegistry
  const pool = deployments.sepolia?.[poolKey]
  if (!registryAddress || !pool) throw new Error('missing deployment records')

  console.log(`proof   ${proofFile}`)
  console.log(`market  ${marketName} at ${pool}\n`)

  // --- does the real attested blob match the layout our Solidity assumes? ---
  console.log('--- decoding the attested transaction locally ---')
  const [txType, groups] = coder.decode(['uint8', 'bytes[]'], proof.txBytes)
  console.log(`  txType ${txType}, groups ${groups.length}`)

  const common = coder.decode(COMMON, groups[0])
  const receipt = coder.decode(RECEIPT, groups[2])
  console.log(`  from   ${common[2]}`)
  console.log(`  to     ${common[4]}`)
  console.log(`  status ${receipt[0]}`)
  console.log(`  logs   ${receipt[2].length}`)

  const repayIndex = receipt[2].findIndex(
    (l: any) => l[0].toLowerCase() === pool.toLowerCase() && l[1][0] === REPAY_TOPIC
  )
  console.log(`  repay log at index ${repayIndex}`)
  if (repayIndex < 0) throw new Error('no Repay log in the attested transaction')

  const borrower = ethers.getAddress('0x' + receipt[2][repayIndex][1][2].slice(26))
  // Read the first word only. Aave's body is (uint256, bool), Compound's is a
  // bare uint256, and the registry reads a word index rather than a shape.
  const body: string = receipt[2][repayIndex][2]
  const amount = BigInt('0x' + body.slice(2, 66))
  console.log(`  borrower ${borrower}`)
  console.log(`  amount   ${amount}`)

  // --- now do it on chain ---
  const [signer] = await ethers.getSigners()
  const registry = await ethers.getContractAt('CreditRegistry', registryAddress, signer)

  const existing = await registry.markets(proof.chainKey, pool)
  if (!existing.enabled) {
    console.log('\nregistering market...')
    const tx = await registry.setMarket(proof.chainKey, pool, REPAY_TOPIC, 2, 0, marketName)
    await tx.wait()
    console.log(`  ${tx.hash}`)
  } else {
    console.log('\nmarket already registered')
  }

  console.log('\n--- recording the repayment on Creditcoin ---')
  console.log(`  registry ${registryAddress}`)
  console.log(`  borrower ${signer.address}`)

  const before = await registry.scoreOf(signer.address)

  const tx = await registry.recordRepayment(
    proof.chainKey,
    proof.height,
    proof.txBytes,
    proof.merkleProof,
    proof.continuityProof,
    repayIndex
  )
  console.log(`  tx ${tx.hash}`)
  const rcpt = await tx.wait()
  console.log(`  mined in block ${rcpt?.blockNumber}, gas ${rcpt?.gasUsed}`)

  const standing = await registry.standingOf(signer.address)
  const after = await registry.scoreOf(signer.address)

  console.log('\n--- standing on chain ---')
  console.log(`  repayments  ${standing.repayments}`)
  console.log(`  totalRepaid ${standing.totalRepaid}`)
  console.log(`  markets     ${standing.markets}`)
  console.log(`  firstHeight ${standing.firstHeight}`)
  console.log(`  lastHeight  ${standing.lastHeight}`)
  console.log(`  score       ${before} -> ${after}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

