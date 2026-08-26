/** Checks whether Compound V3 on Sepolia can give us a second real market to read. */
const { JsonRpcProvider, Network, Contract, formatUnits, id } = require('ethers')
const { readFileSync } = require('fs')
const { join } = require('path')

const COMET = '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'

function env(k) {
  const l = readFileSync(join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/)
    .find((x) => x.startsWith(k + '='))
  return l ? l.slice(k.length + 1) : undefined
}

const cometAbi = [
  'function baseToken() view returns (address)',
  'function numAssets() view returns (uint8)',
  'function getAssetInfo(uint8) view returns (uint8 offset,address asset,address priceFeed,uint64 scale,uint64 borrowCollateralFactor,uint64 liquidateCollateralFactor,uint64 liquidationFactor,uint128 supplyCap)',
  'function borrowBalanceOf(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function baseBorrowMin() view returns (uint256)',
  'function isBorrowCollateralized(address) view returns (bool)'
]

async function main() {
  const provider = new JsonRpcProvider(env('SEPOLIA_RPC_URL'), Network.from(11155111), {
    staticNetwork: true
  })
  const me = env('DEPLOYER_ADDRESS')

  const code = await provider.getCode(COMET)
  console.log(`Comet ${COMET}`)
  console.log(`  code ${(code.length - 2) / 2} bytes`)
  if (code === '0x') throw new Error('nothing deployed there')

  const comet = new Contract(COMET, cometAbi, provider)

  const base = await comet.baseToken()
  const baseToken = new Contract(
    base,
    ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'],
    provider
  )
  const [sym, dec, held] = await Promise.all([
    baseToken.symbol(),
    baseToken.decimals(),
    baseToken.balanceOf(me)
  ])

  console.log(`\nbase asset  ${sym} ${base} (${dec} dp)`)
  console.log(`  we hold   ${formatUnits(held, dec)}`)
  console.log(`  borrowMin ${formatUnits(await comet.baseBorrowMin(), dec)}`)

  const n = await comet.numAssets()
  console.log(`\n${n} collateral assets:`)
  for (let i = 0; i < n; i++) {
    const a = await comet.getAssetInfo(i)
    const t = new Contract(
      a.asset,
      ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'],
      provider
    )
    try {
      const [s, d, b] = await Promise.all([t.symbol(), t.decimals(), t.balanceOf(me)])
      console.log(`  ${s.padEnd(8)} ${a.asset}  ours ${formatUnits(b, d)}  cf ${a.borrowCollateralFactor}`)
    } catch {
      console.log(`  ???      ${a.asset}`)
    }
  }

  console.log(`\nour position`)
  console.log(`  supplied  ${formatUnits(await comet.balanceOf(me), dec)}`)
  console.log(`  borrowed  ${formatUnits(await comet.borrowBalanceOf(me), dec)}`)

  console.log('\nevent signatures Comet emits for a repayment:')
  console.log(`  Supply(address,address,uint256)  ${id('Supply(address,address,uint256)')}`)
  console.log(`  Withdraw(address,address,uint256) ${id('Withdraw(address,address,uint256)')}`)
}

main().catch((e) => {
  console.error('FAILED:', e.shortMessage ?? e.message)
  process.exit(1)
})
