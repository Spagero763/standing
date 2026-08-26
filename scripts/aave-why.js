const { JsonRpcProvider, Network, Contract, Wallet, formatUnits } = require('ethers')
const { readFileSync } = require('fs')
const { join } = require('path')

const POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951'
const DEBT = '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357'
const VARIABLE = 2

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
  const w = new Wallet(env('DEPLOYER_KEY'), provider)

  const dai = new Contract(
    DEBT,
    [
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address,address) view returns (uint256)'
    ],
    provider
  )
  const pool = new Contract(
    POOL,
    [
      'function repay(address,uint256,uint256,address) returns (uint256)',
      'function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'
    ],
    w
  )

  console.log(`DAI balance   ${formatUnits(await dai.balanceOf(w.address), 18)}`)
  console.log(`DAI allowance ${formatUnits(await dai.allowance(w.address, POOL), 18)}`)
  const a = await pool.getUserAccountData(w.address)
  console.log(`debt (base)   ${a[1]}`)
  console.log(`health        ${a[5]}`)

  for (const amt of [1n, 2n, 3n]) {
    const wei = amt * 10n ** 18n
    try {
      await pool.repay.staticCall(DEBT, wei, VARIABLE, w.address)
      console.log(`repay ${amt} DAI -> OK`)
    } catch (e) {
      console.log(`repay ${amt} DAI -> ${String(e.shortMessage ?? e.message).slice(0, 70)}`)
    }
  }
}

main().catch((e) => console.error('FAILED:', e.shortMessage ?? e.message))
