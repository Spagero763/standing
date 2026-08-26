/** Works out which reserve will actually let us borrow, and why the others will not. */
const { JsonRpcProvider, Network, Contract, Wallet, formatUnits } = require('ethers')
const { readFileSync } = require('fs')
const { join } = require('path')

const POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951'
const DATA = '0x3e9708d80f7B3e43118013075F7e95CE3AB31F31'
const VARIABLE = 2

function env(key) {
  const line = readFileSync(join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1) : undefined
}

const dataAbi = [
  'function getReserveCaps(address) view returns (uint256 borrowCap, uint256 supplyCap)',
  'function getReserveTokensAddresses(address) view returns (address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress)',
  'function getReserveConfigurationData(address) view returns (uint256 decimals,uint256 ltv,uint256 liquidationThreshold,uint256 liquidationBonus,uint256 reserveFactor,bool usageAsCollateralEnabled,bool borrowingEnabled,bool stableBorrowRateEnabled,bool isActive,bool isFrozen)'
]

async function main() {
  const provider = new JsonRpcProvider(env('SEPOLIA_RPC_URL'), Network.from(11155111), {
    staticNetwork: true
  })
  const wallet = new Wallet(env('DEPLOYER_KEY'), provider)

  const pool = new Contract(
    POOL,
    [
      'function getReservesList() view returns (address[])',
      'function borrow(address,uint256,uint256,uint16,address)',
      'function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'
    ],
    wallet
  )
  const data = new Contract(DATA, dataAbi, provider)

  const acct = await pool.getUserAccountData(wallet.address)
  console.log(`collateral ${acct[0]}  debt ${acct[1]}  borrowable ${acct[2]}\n`)

  const reserves = await pool.getReservesList()

  for (const asset of reserves) {
    const token = new Contract(
      asset,
      ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'],
      provider
    )

    let sym = '???'
    try {
      sym = await token.symbol()
      const dec = await token.decimals()
      const cfg = await data.getReserveConfigurationData(asset)
      const caps = await data.getReserveCaps(asset)
      const tokens = await data.getReserveTokensAddresses(asset)
      const liquidity = await token.balanceOf(tokens.aTokenAddress)

      const debtToken = new Contract(
        tokens.variableDebtTokenAddress,
        ['function totalSupply() view returns (uint256)'],
        provider
      )
      const borrowed = await debtToken.totalSupply()
      const borrowedUnits = borrowed / 10n ** BigInt(dec)
      const capHead = caps.borrowCap === 0n ? 'uncapped' : String(caps.borrowCap - borrowedUnits)

      // A tenth of a token, enough to prove the flow without moving anything.
      const probe = 10n ** BigInt(dec) / 10n

      let verdict
      try {
        await pool.borrow.staticCall(asset, probe, VARIABLE, 0, wallet.address)
        verdict = 'BORROWABLE'
      } catch (e) {
        verdict = String(e.shortMessage ?? e.message).replace('execution reverted: ', '').slice(0, 44)
      }

      console.log(
        `${sym.padEnd(7)} borrowEnabled ${String(cfg.borrowingEnabled).padEnd(5)} ` +
          `frozen ${String(cfg.isFrozen).padEnd(5)} capHead ${capHead.padEnd(10)} ` +
          `liq ${formatUnits(liquidity, dec).padEnd(14)} -> ${verdict}`
      )
    } catch (e) {
      console.log(`${sym.padEnd(7)} inspection failed: ${String(e.shortMessage ?? e.message).slice(0, 40)}`)
    }
  }
}

main().catch((e) => {
  console.error('FAILED:', e.shortMessage ?? e.message)
  process.exit(1)
})
