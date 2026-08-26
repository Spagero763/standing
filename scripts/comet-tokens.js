/** Can we actually obtain Compound's Sepolia test tokens? Probes the usual faucet shapes. */
const { JsonRpcProvider, Network, Contract, Wallet } = require('ethers')
const { readFileSync } = require('fs')
const { join } = require('path')

const TOKENS = {
  USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  COMP: '0xA6c8D1c55951e8AC44a0EaA959Be5Fd21cc07531',
  WBTC: '0xa035b9e130F2B1AedC733eEFb1C67Ba4c503491F',
  WETH: '0x2D5ee574e710219a521449679A4A7f2B43f046ad'
}

const CANDIDATES = [
  ['allocateTo(address,uint256)', 'function allocateTo(address,uint256)'],
  ['mint(address,uint256)', 'function mint(address,uint256)'],
  ['mint(uint256)', 'function mint(uint256)'],
  ['drip(address)', 'function drip(address)'],
  ['deposit()', 'function deposit() payable']
]

function env(k) {
  const l = readFileSync(join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/)
    .find((x) => x.startsWith(k + '='))
  return l ? l.slice(k.length + 1) : undefined
}

async function main() {
  const provider = new JsonRpcProvider(env('SEPOLIA_RPC_URL'), Network.from(11155111), {
    staticNetwork: true
  })
  const wallet = new Wallet(env('DEPLOYER_KEY'), provider)

  for (const [sym, addr] of Object.entries(TOKENS)) {
    const results = []
    for (const [label, frag] of CANDIDATES) {
      const c = new Contract(addr, [frag], wallet)
      const name = frag.split(' ')[1].split('(')[0]
      try {
        if (label === 'mint(uint256)') await c[name].staticCall(1000n)
        else if (label === 'drip(address)') await c[name].staticCall(wallet.address)
        else if (label === 'deposit()') await c[name].staticCall({ value: 1n })
        else await c[name].staticCall(wallet.address, 1000n)
        results.push(`${label} OK`)
      } catch (e) {
        const m = String(e.shortMessage ?? e.message)
        if (!m.includes('could not decode') && !m.includes('no matching')) {
          results.push(`${label} ${m.slice(0, 26)}`)
        }
      }
    }
    console.log(`${sym.padEnd(6)} ${addr}`)
    console.log(`       ${results.length ? results.join('  |  ') : 'no faucet method found'}`)
  }
}

main().catch((e) => {
  console.error('FAILED:', e.shortMessage ?? e.message)
  process.exit(1)
})
