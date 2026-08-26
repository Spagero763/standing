/**
 * Confirms the exact decode layout our Solidity has to implement.
 *
 * Shape is abi.encode(uint8 txType, bytes[3] groups) where each group is
 * itself an abi.encode of one field set: the common transaction fields, the
 * type specific fields, then the receipt.
 */
const { JsonRpcProvider, Network, AbiCoder } = require('ethers')
const { encoding } = require('@gluwa/usc-sdk')
const { readFileSync } = require('fs')
const { join } = require('path')

const RPC =
  readFileSync(join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('SEPOLIA_RPC_URL='))
    ?.slice('SEPOLIA_RPC_URL='.length) ?? 'https://ethereum-sepolia-rpc.publicnode.com'

const coder = AbiCoder.defaultAbiCoder()

const COMMON = ['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes']
const RECEIPT = ['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes']

async function main() {
  const provider = new JsonRpcProvider(RPC, Network.from(11155111), { staticNetwork: true })
  const head = await provider.getBlockNumber()

  let target = null
  for (let back = 4; back < 40 && !target; back++) {
    const block = await provider.getBlock(head - back)
    if (!block) continue
    for (const hash of block.transactions.slice(0, 12)) {
      const r = await provider.getTransactionReceipt(hash)
      if (r && r.status === 1 && r.logs.length > 0) target = { hash, receipt: r }
      if (target) break
    }
  }

  const withRaw = await encoding.getTransactionWithRaw(provider, target.hash)
  const { abi } = encoding.abiEncode(withRaw, target.receipt)

  const [txType, groups] = coder.decode(['uint8', 'bytes[]'], abi)
  console.log(`tx ${target.hash}`)
  console.log(`txType ${txType}, ${groups.length} groups\n`)

  const common = coder.decode(COMMON, groups[0])
  console.log('--- common ---')
  console.log(`  nonce     ${common[0]}`)
  console.log(`  gasLimit  ${common[1]}`)
  console.log(`  from      ${common[2]}`)
  console.log(`  toIsNull  ${common[3]}`)
  console.log(`  to        ${common[4]}`)
  console.log(`  value     ${common[5]}`)
  console.log(`  dataLen   ${(common[6].length - 2) / 2}`)

  const receipt = coder.decode(RECEIPT, groups[2])
  console.log('\n--- receipt ---')
  console.log(`  status    ${receipt[0]}`)
  console.log(`  gasUsed   ${receipt[1]}`)
  console.log(`  logs      ${receipt[2].length}`)
  receipt[2].forEach((log, i) => {
    console.log(`    log[${i}] address ${log[0]}`)
    console.log(`           topic0  ${log[1][0]}`)
    console.log(`           topics  ${log[1].length}, dataLen ${(log[2].length - 2) / 2}`)
  })

  console.log('\n--- cross check against the node ---')
  const actual = target.receipt
  const ok =
    common[2].toLowerCase() === withRaw.formatted.from.toLowerCase() &&
    common[4].toLowerCase() === (withRaw.formatted.to ?? '').toLowerCase() &&
    Number(receipt[0]) === actual.status &&
    receipt[2].length === actual.logs.length &&
    receipt[2][0][0].toLowerCase() === actual.logs[0].address.toLowerCase() &&
    receipt[2][0][1][0] === actual.logs[0].topics[0]

  console.log(ok ? '  MATCHES the node exactly' : '  MISMATCH')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
