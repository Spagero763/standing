import { ethers, network } from 'hardhat'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const RECORD = join(__dirname, '..', 'deployments.json')

async function main() {
  const [signer] = await ethers.getSigners()
  const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {}
  const registryAddress = record[network.name]?.CreditRegistry
  if (!registryAddress) throw new Error('deploy the registry first')

  console.log(`network  ${network.name}`)
  console.log(`account  ${signer.address}\n`)

  const usd = await ethers.deployContract('TestUSD')
  await usd.waitForDeployment()
  const usdAddress = await usd.getAddress()
  console.log(`TestUSD     ${usdAddress}`)

  const line = await ethers.deployContract('CreditLine', [
    signer.address,
    usdAddress,
    registryAddress
  ])
  await line.waitForDeployment()
  const lineAddress = await line.getAddress()
  console.log(`CreditLine  ${lineAddress}\n`)

  console.log('funding the pool...')
  await (await usd.mint(signer.address, 50_000_000n)).wait()
  await (await usd.approve(lineAddress, 50_000_000n)).wait()
  await (await line.fund(20_000_000n)).wait()
  console.log(`  liquidity ${await line.available()}`)

  const registry = await ethers.getContractAt('CreditRegistry', registryAddress)
  const score = await registry.scoreOf(signer.address)
  const limit = await line.limitOf(signer.address)

  console.log(`\nproven score  ${score}`)
  console.log(`credit limit  ${limit}`)

  if (limit === 0n) {
    console.log('\nno credit yet, prove a repayment first')
  } else {
    console.log('\ndrawing the full line, no collateral posted...')
    const before = await usd.balanceOf(signer.address)
    const tx = await line.draw(limit)
    const rcpt = await tx.wait()
    const after = await usd.balanceOf(signer.address)

    console.log(`  tx       ${tx.hash}`)
    console.log(`  gas      ${rcpt?.gasUsed}`)
    console.log(`  received ${after - before}`)
    console.log(`  owed     ${await line.owedBy(signer.address)}`)
    console.log(`  due      ${(await line.loanOf(signer.address)).dueAt}`)
  }

  record[network.name] = {
    ...record[network.name],
    TestUSD: usdAddress,
    CreditLine: lineAddress
  }
  writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n')
  console.log('\nrecorded in deployments.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
