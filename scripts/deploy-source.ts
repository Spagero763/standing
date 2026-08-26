import { ethers, network } from 'hardhat'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { id } from 'ethers'

const RECORD = join(__dirname, '..', 'deployments.json')
const REPAY_TOPIC = id('Repay(address,address,address,uint256,bool)')

const LOAN = 250_000n // 0.25 tUSD at six decimals

async function main() {
  const [signer] = await ethers.getSigners()
  console.log(`network  ${network.name}`)
  console.log(`account  ${signer.address}`)
  console.log(`balance  ${ethers.formatEther(await ethers.provider.getBalance(signer.address))}\n`)

  const usd = await ethers.deployContract('TestUSD')
  await usd.waitForDeployment()
  const usdAddress = await usd.getAddress()
  console.log(`TestUSD          ${usdAddress}`)

  const pool = await ethers.deployContract('DemoLendingPool')
  await pool.waitForDeployment()
  const poolAddress = await pool.getAddress()
  console.log(`DemoLendingPool  ${poolAddress}\n`)

  console.log('funding pool and borrower...')
  await (await usd.mint(poolAddress, 10_000_000n)).wait()
  await (await usd.mint(signer.address, 10_000_000n)).wait()

  console.log('borrowing...')
  await (await pool.borrow(usdAddress, LOAN)).wait()

  console.log('approving...')
  await (await usd.approve(poolAddress, LOAN)).wait()

  console.log('repaying...')
  const repayTx = await pool.repay(usdAddress, LOAN, signer.address)
  const receipt = (await repayTx.wait())!

  const logIndex = receipt.logs.findIndex(
    (l) => l.address.toLowerCase() === poolAddress.toLowerCase() && l.topics[0] === REPAY_TOPIC
  )

  console.log(`\nrepay tx     ${receipt.hash}`)
  console.log(`block        ${receipt.blockNumber}`)
  console.log(`logs         ${receipt.logs.length}`)
  console.log(`repay log at ${logIndex}`)

  if (logIndex < 0) throw new Error('no Repay log found in the receipt')

  const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {}
  record[network.name] = {
    ...(record[network.name] ?? {}),
    TestUSD: usdAddress,
    DemoLendingPool: poolAddress,
    lastRepay: {
      hash: receipt.hash,
      block: receipt.blockNumber,
      logIndex,
      borrower: signer.address,
      amount: LOAN.toString()
    }
  }
  writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n')
  console.log('\nrecorded in deployments.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
