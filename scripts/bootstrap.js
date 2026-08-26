const { Wallet } = require('ethers')
const { existsSync, readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const ENV = join(__dirname, '..', '.env')

const SEPOLIA_CANDIDATES = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.drpc.org',
  'https://rpc.sepolia.org',
  'https://1rpc.io/sepolia',
  'https://sepolia.gateway.tenderly.co'
]

const CREDITCOIN_TESTNET = 'https://rpc.cc3-testnet.creditcoin.network'

async function rpc(url, method, params = [], ms = 8000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(ms)
  })
  const body = await res.json()
  if (body.error) throw new Error(body.error.message)
  return body.result
}

async function probe(url, expectedChainId) {
  const started = Date.now()
  try {
    const [chainId, block] = await Promise.all([
      rpc(url, 'eth_chainId'),
      rpc(url, 'eth_blockNumber')
    ])
    if (parseInt(chainId, 16) !== expectedChainId) {
      return { url, ok: false, note: `wrong chain ${parseInt(chainId, 16)}` }
    }
    return { url, ok: true, block: parseInt(block, 16), ms: Date.now() - started }
  } catch (err) {
    return { url, ok: false, note: String(err.message || err).slice(0, 60) }
  }
}

function readEnv() {
  if (!existsSync(ENV)) return {}
  const out = {}
  for (const line of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

async function main() {
  const cc = await probe(CREDITCOIN_TESTNET, 102031)
  console.log('--- Creditcoin testnet ---')
  console.log(cc.ok ? `  OK   block ${cc.block} (${cc.ms}ms)` : `  DOWN ${cc.note}`)

  console.log('\n--- Sepolia candidates ---')
  const results = await Promise.all(SEPOLIA_CANDIDATES.map((u) => probe(u, 11155111)))
  for (const r of results) {
    console.log(r.ok ? `  OK   ${r.url}  block ${r.block} (${r.ms}ms)` : `  FAIL ${r.url}  ${r.note}`)
  }

  const best = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms)[0]

  const existing = readEnv()
  if (existing.DEPLOYER_KEY) {
    console.log(`\nBurner already exists: ${new Wallet(existing.DEPLOYER_KEY).address}`)
    return
  }

  const wallet = Wallet.createRandom()
  writeFileSync(
    ENV,
    [
      '# Testnet only. Never send anything of value to this address.',
      `DEPLOYER_KEY=${wallet.privateKey}`,
      `DEPLOYER_ADDRESS=${wallet.address}`,
      `SEPOLIA_RPC_URL=${best ? best.url : SEPOLIA_CANDIDATES[0]}`,
      `CREDITCOIN_RPC_URL=${CREDITCOIN_TESTNET}`,
      'CREDITCOIN_PROOF_BUILDER_URL=https://proof-gen-api.cc3-testnet.creditcoin.network',
      'SOURCE_CHAIN_KEY=1',
      ''
    ].join('\n'),
    'utf8'
  )

  console.log('\n--- Burner wallet created ---')
  console.log(`  address: ${wallet.address}`)
  console.log('  private key written to .env (gitignored)')
  console.log(`\n  Sepolia RPC selected: ${best ? best.url : 'none reachable'}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
