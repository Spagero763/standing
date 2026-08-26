/**
 * A second real money market. Compound V3 on Sepolia, whose repayment emits
 * Supply(address,address,uint256) rather than Aave's Repay(...), proving the
 * registry reads markets by configuration and not by hardcoded shape.
 */
const { JsonRpcProvider, Network, Contract, Wallet, formatUnits, parseEther, id } = require('ethers')
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..')
const COMET = '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e'
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const WETH = '0x2D5ee574e710219a521449679A4A7f2B43f046ad'

const SUPPLY_TOPIC = id('Supply(address,address,uint256)')

const WRAP = parseEther('0.008')
const BORROW = 2_000_000n // 2 USDC
const REPAY = 800_000n // 0.8 USDC

function env(k) {
  const l = readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((x) => x.startsWith(k + '='))
  return l ? l.slice(k.length + 1) : undefined
}

const cometAbi = [
  'function supply(address asset, uint amount)',
  'function withdraw(address asset, uint amount)',
  'function borrowBalanceOf(address) view returns (uint256)',
  'function collateralBalanceOf(address, address) view returns (uint128)',
  'function isBorrowCollateralized(address) view returns (bool)'
]
const wethAbi = [
  'function deposit() payable',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)'
]
const erc20 = [
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)'
]

async function send(label, promise) {
  process.stdout.write(`  ${label.padEnd(24)}`)
  const rcpt = await (await promise).wait()
  console.log(`ok  ${rcpt.hash.slice(0, 12)}  gas ${rcpt.gasUsed}`)
  return rcpt
}

async function main() {
  const provider = new JsonRpcProvider(env('SEPOLIA_RPC_URL'), Network.from(11155111), {
    staticNetwork: true
  })
  const wallet = new Wallet(env('DEPLOYER_KEY'), provider)

  const comet = new Contract(COMET, cometAbi, wallet)
  const weth = new Contract(WETH, wethAbi, wallet)
  const usdc = new Contract(USDC, erc20, wallet)

  console.log(`account ${wallet.address}`)
  console.log(`comet   ${COMET}\n`)

  if ((await weth.balanceOf(wallet.address)) < WRAP) {
    await send('wrap ETH', weth.deposit({ value: WRAP }))
  }

  if ((await comet.collateralBalanceOf(wallet.address, WETH)) === 0n) {
    await send('approve WETH', weth.approve(COMET, WRAP))
    await send('supply WETH', comet.supply(WETH, WRAP))
  }

  console.log(`\n  collateral WETH ${formatUnits(await comet.collateralBalanceOf(wallet.address, WETH), 18)}`)
  console.log(`  collateralised  ${await comet.isBorrowCollateralized(wallet.address)}`)

  if ((await comet.borrowBalanceOf(wallet.address)) < REPAY) {
    await send('\n  borrow USDC'.trim(), comet.withdraw(USDC, BORROW))
  }

  const owed = await comet.borrowBalanceOf(wallet.address)
  console.log(`  borrowed        ${formatUnits(owed, 6)} USDC\n`)

  await send('approve USDC', usdc.approve(COMET, REPAY * 2n))
  await new Promise((r) => setTimeout(r, 5000))
  const rcpt = await send('repay USDC', comet.supply(USDC, REPAY, { gasLimit: 500_000 }))

  const logIndex = rcpt.logs.findIndex(
    (l) => l.address.toLowerCase() === COMET.toLowerCase() && l.topics[0] === SUPPLY_TOPIC
  )

  console.log('\n--- the repayment ---')
  console.log(`  tx        ${rcpt.hash}`)
  console.log(`  block     ${rcpt.blockNumber}`)
  console.log(`  Supply at ${logIndex}`)
  if (logIndex < 0) throw new Error('no Supply log from Comet')

  const log = rcpt.logs[logIndex]
  console.log(`  from      0x${log.topics[1].slice(26)}`)
  console.log(`  dst       0x${log.topics[2].slice(26)}`)
  console.log(`  remaining ${formatUnits(await comet.borrowBalanceOf(wallet.address), 6)} USDC`)

  const record = JSON.parse(readFileSync(join(ROOT, 'deployments.json'), 'utf8'))
  record.sepolia = {
    ...record.sepolia,
    CompoundV3Comet: COMET,
    cometRepay: {
      hash: rcpt.hash,
      block: rcpt.blockNumber,
      logIndex,
      borrower: wallet.address,
      amount: REPAY.toString(),
      topic: SUPPLY_TOPIC
    }
  }
  writeFileSync(join(ROOT, 'deployments.json'), JSON.stringify(record, null, 2) + '\n')
  console.log('\nrecorded in deployments.json')
}

main().catch((e) => {
  console.error('FAILED:', e.shortMessage ?? e.message)
  process.exit(1)
})
