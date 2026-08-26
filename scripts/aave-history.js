/**
 * Builds a multi-repayment history on the real Aave V3 pool so the batch path
 * has something genuine to prove.
 */
const { JsonRpcProvider, Network, Contract, Wallet, formatUnits, id } = require('ethers')
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..')
const POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951'
const FAUCET = '0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D'
const DEBT = '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357'

const REPAY_TOPIC = id('Repay(address,address,address,uint256,bool)')
const VARIABLE = 2

const TOP_UP_BORROW = 9n * 10n ** 18n
const CHUNK = 2n * 10n ** 18n
const CHUNKS = 3

function env(key) {
  const line = readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1) : undefined
}

const poolAbi = [
  'function borrow(address,uint256,uint256,uint16,address)',
  'function repay(address,uint256,uint256,address) returns (uint256)',
  'function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'
]
const erc20Abi = [
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)'
]

async function main() {
  const provider = new JsonRpcProvider(env('SEPOLIA_RPC_URL'), Network.from(11155111), {
    staticNetwork: true
  })
  const wallet = new Wallet(env('DEPLOYER_KEY'), provider)

  const pool = new Contract(POOL, poolAbi, wallet)
  const dai = new Contract(DEBT, erc20Abi, wallet)
  const faucet = new Contract(FAUCET, ['function mint(address,address,uint256) returns (uint256)'], wallet)

  const needed = CHUNK * BigInt(CHUNKS) + 10n ** 18n
  if ((await dai.balanceOf(wallet.address)) < needed) {
    console.log('minting DAI...')
    await (await faucet.mint(DEBT, wallet.address, 1000n * 10n ** 18n)).wait()
  }

  const acct = await pool.getUserAccountData(wallet.address)
  console.log(`collateral ${acct[0]}  debt ${acct[1]}  borrowable ${acct[2]}`)

  // Debt is reported in USD base units with eight decimals. Make sure there is
  // comfortably more of it than we are about to repay, or a later chunk reverts.
  const needDebt = (CHUNK * BigInt(CHUNKS) * 12n) / 10n / 10n ** 10n
  if (acct[1] < needDebt) {
    console.log(`borrowing ${formatUnits(TOP_UP_BORROW, 18)} DAI...`)
    await (await pool.borrow(DEBT, TOP_UP_BORROW, VARIABLE, 0, wallet.address)).wait()
    const next = await pool.getUserAccountData(wallet.address)
    console.log(`  debt now ${next[1]}`)
  }

  console.log(`\napproving ${formatUnits(CHUNK * BigInt(CHUNKS), 18)} DAI...`)
  await (await dai.approve(POOL, CHUNK * BigInt(CHUNKS) * 2n)).wait()

  const repayments = []
  for (let i = 0; i < CHUNKS; i++) {
    process.stdout.write(`  repay ${i + 1}/${CHUNKS}  `)

    // The public RPC lags a block behind itself often enough that estimateGas
    // fails on a state it has not caught up to. Skip the estimate and wait.
    if (i > 0) await new Promise((r) => setTimeout(r, 6000))
    const rcpt = await (
      await pool.repay(DEBT, CHUNK, VARIABLE, wallet.address, { gasLimit: 450_000 })
    ).wait()
    const logIndex = rcpt.logs.findIndex(
      (l) => l.address.toLowerCase() === POOL.toLowerCase() && l.topics[0] === REPAY_TOPIC
    )
    console.log(`block ${rcpt.blockNumber}  log ${logIndex}  ${rcpt.hash.slice(0, 12)}`)
    repayments.push({
      hash: rcpt.hash,
      block: rcpt.blockNumber,
      logIndex,
      amount: CHUNK.toString()
    })
  }

  const record = JSON.parse(readFileSync(join(ROOT, 'deployments.json'), 'utf8'))
  record.sepolia = { ...record.sepolia, AaveV3Pool: POOL, aaveHistory: repayments }
  writeFileSync(join(ROOT, 'deployments.json'), JSON.stringify(record, null, 2) + '\n')

  console.log(`\nrecorded ${repayments.length} repayments spanning blocks ` +
    `${repayments[0].block} to ${repayments[repayments.length - 1].block}`)
}

main().catch((e) => {
  console.error('FAILED:', e.shortMessage ?? e.message)
  process.exit(1)
})
