import { ethers, network } from 'hardhat'
import { readFileSync } from 'fs'
import { join } from 'path'

/** Leaves headroom on the line so anyone opening the page can draw against it. */
async function main() {
  const record = JSON.parse(readFileSync(join(__dirname, '..', 'deployments.json'), 'utf8'))
  const lineAddress = record[network.name]?.CreditLine
  const usdAddress = record[network.name]?.TestUSD
  if (!lineAddress || !usdAddress) throw new Error('missing deployment records')

  const [signer] = await ethers.getSigners()
  const line = await ethers.getContractAt('CreditLine', lineAddress, signer)
  const usd = await ethers.getContractAt('TestUSD', usdAddress, signer)

  const owed = await line.owedBy(signer.address)
  const limit = await line.limitOf(signer.address)
  console.log(`limit ${limit}  owed ${owed}`)

  if (owed === 0n) {
    console.log('nothing owed')
    return
  }

  const repay = owed / 2n
  console.log(`\nrepaying ${repay}...`)

  await (await usd.approve(lineAddress, repay * 2n)).wait()
  const tx = await line.repay(repay)
  const rcpt = await tx.wait()
  console.log(`  tx  ${tx.hash}`)
  console.log(`  gas ${rcpt?.gasUsed}`)

  const after = await line.owedBy(signer.address)
  console.log(`\nowed     ${after}`)
  console.log(`headroom ${limit > after ? limit - after : 0n}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
