/** Finds a reserve on Aave Sepolia that will actually accept a supply and allow a borrow. */
const { JsonRpcProvider, Network, Contract, formatUnits } = require('ethers')
const { readFileSync } = require('fs')
const { join } = require('path')

const POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951'
const DATA = '0x3e9708d80f7B3e43118013075F7e95CE3AB31F31'

function env(key) {
  const line = readFileSync(join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1) : undefined
}

const dataAbi = [
  'function getReserveCaps(address) view returns (uint256 borrowCap, uint256 supplyCap)',
  'function getATokenTotalSupply(address) view returns (uint256)',
  'function getReserveConfigurationData(address) view returns (uint256 decimals,uint256 ltv,uint256 liquidationThreshold,uint256 liquidationBonus,uint256 reserveFactor,bool usageAsCollateralEnabled,bool borrowingEnabled,bool stableBorrowRateEnabled,bool isActive,bool isFrozen)',
  'function getTotalDebt(address) view returns (uint256)'
]

async function main() {
  const provider = new JsonRpcProvider(env('SEPOLIA_RPC_URL'), Network.from(11155111), {
    staticNetwork: true
  })
  const pool = new Contract(POOL, ['function getReservesList() view returns (address[])'], provider)
  const data = new Contract(DATA, dataAbi, provider)

  const reserves = await pool.getReservesList()
  const rows = []

  for (const asset of reserves) {
    const token = new Contract(
      asset,
      ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
      provider
    )
    try {
      const [sym, dec, caps, supplied, cfg] = await Promise.all([
        token.symbol(),
        token.decimals(),
        data.getReserveCaps(asset),
        data.getATokenTotalSupply(asset),
        data.getReserveConfigurationData(asset)
      ])

      const capUnits = caps.supplyCap // whole tokens, 0 means uncapped
      const suppliedUnits = supplied / 10n ** BigInt(dec)
      const headroom = capUnits === 0n ? null : capUnits - suppliedUnits

      rows.push({
        sym,
        asset,
        dec: Number(dec),
        cap: capUnits,
        supplied: suppliedUnits,
        headroom,
        collateral: cfg.usageAsCollateralEnabled,
        borrowable: cfg.borrowingEnabled,
        active: cfg.isActive,
        frozen: cfg.isFrozen,
        ltv: cfg.ltv
      })
    } catch (e) {
      rows.push({ sym: '???', asset, error: String(e.shortMessage ?? e.message).slice(0, 40) })
    }
  }

  console.log('symbol   supplyCap      supplied      headroom   collat borrow active frozen ltv')
  for (const r of rows) {
    if (r.error) {
      console.log(`${r.sym.padEnd(8)} ${r.error}`)
      continue
    }
    const head = r.headroom === null ? 'uncapped' : String(r.headroom)
    console.log(
      `${r.sym.padEnd(8)} ${String(r.cap).padEnd(14)} ${String(r.supplied).padEnd(13)} ${head.padEnd(10)} ` +
        `${String(r.collateral).padEnd(6)} ${String(r.borrowable).padEnd(6)} ${String(r.active).padEnd(6)} ${String(r.frozen).padEnd(6)} ${r.ltv}`
    )
  }

  const usable = rows.filter(
    (r) =>
      !r.error &&
      r.active &&
      !r.frozen &&
      r.collateral &&
      r.borrowable &&
      r.ltv > 0n &&
      (r.headroom === null || r.headroom > 100n)
  )

  console.log('\n--- usable for supply + borrow ---')
  if (usable.length === 0) {
    console.log('  none with headroom')
  } else {
    for (const r of usable) {
      console.log(`  ${r.sym.padEnd(8)} ${r.asset}  headroom ${r.headroom ?? 'uncapped'}  ltv ${r.ltv}`)
    }
  }
}

main().catch((e) => {
  console.error('FAILED:', e.shortMessage ?? e.message)
  process.exit(1)
})
