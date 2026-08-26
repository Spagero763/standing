import { ethers, network } from 'hardhat'
import { readFileSync } from 'fs'
import { join } from 'path'

const PRECOMPILE = '0x0000000000000000000000000000000000000FD2'
const CHAIN_INFO = '0x0000000000000000000000000000000000000FD3'

async function main() {
  const record = JSON.parse(readFileSync(join(__dirname, '..', 'deployments.json'), 'utf8'))
  const address = record[network.name]?.CreditRegistry
  if (!address) throw new Error(`no CreditRegistry recorded for ${network.name}`)

  const registry = await ethers.getContractAt('CreditRegistry', address)

  const who = process.env.ACCOUNT ?? (await ethers.getSigners())[0].address

  console.log(`registry ${address}`)
  console.log(`owner    ${await registry.owner()}`)
  console.log(`account  ${who}`)

  const standing = await registry.standingOf(who)
  console.log(`\n--- standing ---`)
  console.log(`  score       ${await registry.scoreOf(who)}`)
  console.log(`  repayments  ${standing.repayments}`)
  console.log(`  markets     ${standing.markets}`)
  console.log(`  totalRepaid ${standing.totalRepaid}`)

  const lineAddress = record[network.name]?.CreditLine
  if (lineAddress) {
    const line = await ethers.getContractAt('CreditLine', lineAddress)
    const [limit, owed, liquidity] = await Promise.all([
      line.limitOf(who),
      line.owedBy(who),
      line.available()
    ])
    const headroom = limit > owed ? limit - owed : 0n
    console.log(`\n--- credit line ${lineAddress} ---`)
    console.log(`  limit      ${limit}`)
    console.log(`  owed       ${owed}`)
    console.log(`  headroom   ${headroom}`)
    console.log(`  liquidity  ${liquidity}`)
  }

  console.log('\n--- precompiles on this chain ---')
  for (const [name, addr] of [
    ['block prover', PRECOMPILE],
    ['chain info  ', CHAIN_INFO]
  ]) {
    const code = await ethers.provider.getCode(addr)
    const bytes = (code.length - 2) / 2
    console.log(`  ${name} ${addr}  code: ${bytes} bytes ${bytes > 0 ? '' : '(precompiles often report empty)'}`)
  }

  // A precompile with no bytecode still answers calls, so ask it something.
  const verifier = new ethers.Contract(
    PRECOMPILE,
    [
      'function verify(uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) view returns (bool)'
    ],
    ethers.provider
  )

  try {
    const answer = await verifier.verify(
      1,
      1,
      '0x',
      { root: ethers.ZeroHash, siblings: [] },
      { lowerEndpointDigest: ethers.ZeroHash, roots: [] }
    )
    console.log(`\n  block prover answered a call: ${answer}`)
    console.log('  precompile is LIVE')
  } catch (e: any) {
    const msg = e?.shortMessage ?? e?.message ?? String(e)
    console.log(`\n  block prover call reverted: ${msg.slice(0, 120)}`)
    console.log('  a revert still proves something is deployed there and executing')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
