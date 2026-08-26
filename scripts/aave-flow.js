/**
 * Borrows and repays on the real Aave V3 deployment on Sepolia, then records
 * where the Repay landed so the registry can prove it.
 *
 * The point is that nothing about this transaction is ours. It is Aave's pool,
 * Aave's event and Aave's accounting.
 */
const { JsonRpcProvider, Network, Contract, Wallet, formatUnits, id } = require('ethers')
const { readFileSync, writeFileSync, existsSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..')
const POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951'
const FAUCET = '0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D'

// Collateral. DAI, USDC and USDT all sit over their supply caps on Sepolia,
// so LINK is the one that will accept a deposit.
const COLLATERAL = '0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5'
const COLLATERAL_SYMBOL = 'LINK'

// What we actually borrow and repay. Supply caps do not gate borrowing.
const DEBT = '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357'
const DEBT_SYMBOL = 'DAI'

const REPAY_TOPIC = id('Repay(address,address,address,uint256,bool)')
const VARIABLE = 2

const MINT = 1_000n * 10n ** 18n
const SUPPLY = 100n * 10n ** 18n
const BORROW = 5n * 10n ** 18n

function env(key) {
  const line = readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1) : undefined
}

const faucetAbi = ['function mint(address token, address to, uint256 amount) returns (uint256)']
const erc20Abi = [
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)'
]
const poolAbi = [
  'function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)',
  'function borrow(address asset,uint256 amount,uint256 interestRateMode,uint16 referralCode,address onBehalfOf)',
  'function repay(address asset,uint256 amount,uint256 interestRateMode,address onBehalfOf) returns (uint256)',
  'function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'
]

async function send(label, promise) {
  process.stdout.write(`  ${label.padEnd(26)}`)
  const tx = await promise
  const rcpt = await tx.wait()
  console.log(`ok  ${rcpt.hash.slice(0, 12)}  gas ${rcpt.gasUsed}`)
  return rcpt
}

async function main() {
  const provider = new JsonRpcProvider(env('SEPOLIA_RPC_URL'), Network.from(11155111), {
    staticNetwork: true
  })
  const wallet = new Wallet(env('DEPLOYER_KEY'), provider)

  const faucet = new Contract(FAUCET, faucetAbi, wallet)
  const collateral = new Contract(COLLATERAL, erc20Abi, wallet)
  const debt = new Contract(DEBT, erc20Abi, wallet)
  const pool = new Contract(POOL, poolAbi, wallet)

  console.log(`account    ${wallet.address}`)
  console.log(`collateral ${COLLATERAL_SYMBOL} ${COLLATERAL}`)
  console.log(`debt       ${DEBT_SYMBOL} ${DEBT}\n`)

  if ((await collateral.balanceOf(wallet.address)) < SUPPLY) {
    await send(`faucet mint ${COLLATERAL_SYMBOL}`, faucet.mint(COLLATERAL, wallet.address, MINT))
  }
  if ((await debt.balanceOf(wallet.address)) < BORROW) {
    await send(`faucet mint ${DEBT_SYMBOL}`, faucet.mint(DEBT, wallet.address, MINT))
  }

  const before = await pool.getUserAccountData(wallet.address)
  if (before[0] === 0n) {
    await send('approve (supply)', collateral.approve(POOL, SUPPLY))
    await send(`supply ${COLLATERAL_SYMBOL}`, pool.supply(COLLATERAL, SUPPLY, wallet.address, 0))
  } else {
    console.log(`  collateral already posted: ${before[0]}`)
  }

  const mid = await pool.getUserAccountData(wallet.address)
  console.log(`\n  collateral ${mid[0]}  debt ${mid[1]}  borrowable ${mid[2]}\n`)

  if (mid[1] === 0n) {
    await send(`borrow ${DEBT_SYMBOL}`, pool.borrow(DEBT, BORROW, VARIABLE, 0, wallet.address))
  } else {
    console.log('  already borrowed')
  }

  const repayAmount = BORROW / 2n
  await send('approve (repay)', debt.approve(POOL, repayAmount))
  const rcpt = await send(
    `repay ${DEBT_SYMBOL}`,
    pool.repay(DEBT, repayAmount, VARIABLE, wallet.address)
  )

  const logIndex = rcpt.logs.findIndex(
    (l) => l.address.toLowerCase() === POOL.toLowerCase() && l.topics[0] === REPAY_TOPIC
  )

  console.log('\n--- the repayment ---')
  console.log(`  tx       ${rcpt.hash}`)
  console.log(`  block    ${rcpt.blockNumber}`)
  console.log(`  logs     ${rcpt.logs.length}`)
  console.log(`  Repay at ${logIndex}`)

  if (logIndex < 0) throw new Error('no Aave Repay log found in the receipt')

  const log = rcpt.logs[logIndex]
  console.log(`  reserve  0x${log.topics[1].slice(26)}`)
  console.log(`  user     0x${log.topics[2].slice(26)}`)
  console.log(`  repayer  0x${log.topics[3].slice(26)}`)

  const record = existsSync(join(ROOT, 'deployments.json'))
    ? JSON.parse(readFileSync(join(ROOT, 'deployments.json'), 'utf8'))
    : {}

  record.sepolia = {
    ...(record.sepolia ?? {}),
    AaveV3Pool: POOL,
    aaveRepay: {
      hash: rcpt.hash,
      block: rcpt.blockNumber,
      logIndex,
      borrower: wallet.address,
      asset: DEBT,
      symbol: DEBT_SYMBOL,
      collateral: COLLATERAL,
      amount: repayAmount.toString()
    }
  }
  writeFileSync(join(ROOT, 'deployments.json'), JSON.stringify(record, null, 2) + '\n')
  console.log('\nrecorded in deployments.json')
}

main().catch((e) => {
  console.error('FAILED:', e.shortMessage ?? e.message)
  process.exit(1)
})

