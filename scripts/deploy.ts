import { ethers, network } from 'hardhat'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

const RECORD = join(__dirname, '..', 'deployments.json')

async function main() {
  const [deployer] = await ethers.getSigners()
  const balance = await ethers.provider.getBalance(deployer.address)

  console.log(`network  ${network.name}`)
  console.log(`deployer ${deployer.address}`)
  console.log(`balance  ${ethers.formatEther(balance)}\n`)

  if (balance === 0n) throw new Error('deployer has no gas')

  const registry = await ethers.deployContract('CreditRegistry', [deployer.address])
  await registry.waitForDeployment()

  const address = await registry.getAddress()
  const tx = registry.deploymentTransaction()
  console.log(`CreditRegistry  ${address}`)
  console.log(`tx              ${tx?.hash}`)

  const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {}
  record[network.name] = {
    ...(record[network.name] ?? {}),
    CreditRegistry: address,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address
  }
  writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n')

  console.log(`\nrecorded in deployments.json`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
