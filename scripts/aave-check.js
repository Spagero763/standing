/** Confirms the real Aave V3 deployment on Sepolia before we build against it. */
const { JsonRpcProvider, Network, Contract, formatEther, formatUnits } = require('ethers')
const { readFileSync } = require('fs')
const { join } = require('path')

const POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951'
const PROVIDER = '0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A'
const DATA = '0x3e9708d80f7B3e43118013075F7e95CE3AB31F31'
const FAUCET = '0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D'

function env(key, fallback) {
  const line = readFileSync(join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1) : fallback
}

const poolAbi = [
  'function getReservesList() view returns (address[])',
  'function ADDRESSES_PROVIDER() view returns (address)',
  'function getUserAccountData(address) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)'
]

const erc20 = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)'
]

async function main() {
  const rpc = env('SEPOLIA_RPC_URL')
  const me = env('DEPLOYER_ADDRESS')
  const provider = new JsonRpcProvider(rpc, Network.from(11155111), { staticNetwork: true })

  console.log(`account ${me}`)
  console.log(`balance ${formatEther(await provider.getBalance(me))} ETH\n`)

  console.log('--- contracts have code? ---')
  for (const [name, addr] of [
    ['Pool          ', POOL],
    ['AddrProvider  ', PROVIDER],
    ['DataProvider  ', DATA],
    ['Faucet        ', FAUCET]
  ]) {
    const code = await provider.getCode(addr)
    console.log(`  ${name} ${addr}  ${(code.length - 2) / 2} bytes`)
  }

  const pool = new Contract(POOL, poolAbi, provider)

  const wired = await pool.ADDRESSES_PROVIDER()
  console.log(`\nPool.ADDRESSES_PROVIDER -> ${wired}`)
  console.log(`  matches expected: ${wired.toLowerCase() === PROVIDER.toLowerCase()}`)

  const reserves = await pool.getReservesList()
  console.log(`\n--- ${reserves.length} reserves ---`)
  for (const asset of reserves) {
    try {
      const t = new Contract(asset, erc20, provider)
      const [sym, dec, bal] = await Promise.all([t.symbol(), t.decimals(), t.balanceOf(me)])
      console.log(`  ${sym.padEnd(8)} ${asset}  dec ${dec}  ours ${formatUnits(bal, dec)}`)
    } catch {
      console.log(`  ???      ${asset}`)
    }
  }

  const acct = await pool.getUserAccountData(me)
  console.log('\n--- our position ---')
  console.log(`  collateral  ${acct.totalCollateralBase}`)
  console.log(`  debt        ${acct.totalDebtBase}`)
  console.log(`  borrowable  ${acct.availableBorrowsBase}`)
}

main().catch((e) => {
  console.error('FAILED:', e.shortMessage ?? e.message)
  process.exit(1)
})
