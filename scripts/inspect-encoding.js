/**
 * Resolves the exact layout Attestcoin encodes a proven transaction into.
 * Read only, no gas. Takes a real Sepolia transaction that already has logs,
 * runs it through the SDK encoder, and prints the type list the on-chain
 * decoder has to match.
 */
const { JsonRpcProvider, Network } = require('ethers')
const { encoding } = require('@gluwa/usc-sdk')
const { readFileSync } = require('fs')
const { join } = require('path')

function env(key, fallback) {
  try {
    const line = readFileSync(join(__dirname, '..', '.env'), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(key + '='))
    return line ? line.slice(key.length + 1) : fallback
  } catch {
    return fallback
  }
}

const RPC = env('SEPOLIA_RPC_URL', 'https://ethereum-sepolia-rpc.publicnode.com')

async function findTxWithLogs(provider) {
  const head = await provider.getBlockNumber()

  for (let back = 4; back < 40; back++) {
    const block = await provider.getBlock(head - back)
    if (!block || block.transactions.length === 0) continue

    for (const hash of block.transactions.slice(0, 12)) {
      const receipt = await provider.getTransactionReceipt(hash)
      if (receipt && receipt.status === 1 && receipt.logs.length > 0) {
        return { hash, receipt, blockNumber: block.number }
      }
    }
  }
  throw new Error('no suitable transaction found in recent blocks')
}

async function main() {
  const provider = new JsonRpcProvider(RPC, Network.from(11155111), { staticNetwork: true })

  console.log(`rpc: ${RPC}`)
  const { hash, receipt, blockNumber } = await findTxWithLogs(provider)
  console.log(`tx:    ${hash}`)
  console.log(`block: ${blockNumber}`)
  console.log(`logs:  ${receipt.logs.length}`)

  const withRaw = await encoding.getTransactionWithRaw(provider, hash)
  if (!withRaw) throw new Error('getTransactionWithRaw returned null')

  console.log(`type:  ${withRaw.formatted.type}`)

  const result = encoding.abiEncode(withRaw, receipt)

  console.log('\n--- encoded types ---')
  result.types.forEach((t, i) => console.log(`  [${i}] ${t}`))
  console.log(`\nencoded length: ${(result.abi.length - 2) / 2} bytes`)
  console.log(`first 32 bytes: ${result.abi.slice(0, 66)}`)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
