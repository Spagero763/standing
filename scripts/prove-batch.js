/**
 * Proves a whole repayment history in one shot. The proof service returns a
 * single continuity proof spanning every block plus one Merkle proof per
 * transaction, which is exactly the shape the batch precompile takes.
 */
const { JsonRpcProvider, Network } = require('ethers')
const { chainInfo, blockProver, proofProvider } = require('@gluwa/usc-sdk')
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..')

function env(key) {
  const line = readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1) : undefined
}

async function main() {
  const deployments = JSON.parse(readFileSync(join(ROOT, 'deployments.json'), 'utf8'))
  const history = deployments.sepolia?.aaveHistory
  if (!history || history.length === 0) throw new Error('no aaveHistory recorded')

  const chainKey = parseInt(env('SOURCE_CHAIN_KEY') ?? '1')
  const creditcoin = new JsonRpcProvider(env('CREDITCOIN_RPC_URL'), Network.from(102031), {
    staticNetwork: true
  })

  const ordered = [...history].sort((a, b) => a.block - b.block)
  const highest = ordered[ordered.length - 1].block

  console.log(`${ordered.length} repayments, blocks ${ordered[0].block} to ${highest}\n`)

  const info = new chainInfo.PrecompileChainInfoProvider(creditcoin)
  const latest = await info.getLatestAttestedHeightAndHash(chainKey)
  console.log(`latest attested ${latest.exists ? latest.height : 'none'}`)

  if (!latest.exists || latest.height < highest) {
    console.log('waiting for attestation...')
    await info.waitUntilHeightAttested(chainKey, highest, 5000, 20 * 60 * 1000, 15000)
  }
  console.log('attested.\n')

  const builder = new proofProvider.service.ProofBuilder(
    chainKey,
    env('CREDITCOIN_PROOF_BUILDER_URL')
  )

  console.log('--- requesting batch proof ---')
  const result = await builder.getBatchProof(ordered.map((r) => r.hash))
  if (!result.success || !result.data) {
    throw new Error(`batch proof failed: ${JSON.stringify(result.error)}`)
  }

  const batch = result.data
  console.log(`  range        ${batch.fromHeader} to ${batch.toHeader}`)
  console.log(`  continuity   ${batch.continuityProof.roots.length} roots`)

  // merkleProofs arrives as Map<height, Map<txIndex, entry>>. Flatten it and
  // key by transaction hash so the order follows our history, not the map's.
  const byHash = new Map()
  for (const [height, inner] of batch.merkleProofs) {
    for (const [txIndex, entry] of inner) {
      byHash.set(entry.txHash.toLowerCase(), { height: Number(height), txIndex, ...entry })
    }
  }
  console.log(`  merkle proofs ${byHash.size}`)

  const heights = []
  const txBytes = []
  const merkleProofs = []
  const logIndexes = []

  for (const item of ordered) {
    const entry = byHash.get(item.hash.toLowerCase())
    if (!entry) throw new Error(`no proof returned for ${item.hash}`)
    heights.push(entry.height)
    txBytes.push(entry.txBytes)
    merkleProofs.push(entry.merkleProof)
    logIndexes.push(item.logIndex)
    console.log(
      `    block ${entry.height}  txIndex ${entry.txIndex}  ` +
        `${(entry.txBytes.length - 2) / 2} bytes  siblings ${entry.merkleProof.siblings.length}`
    )
  }

  console.log('\n--- verifying the batch against the live precompile ---')
  const prover = new blockProver.PrecompileBlockProver(creditcoin)
  const ok = await prover.verifyBatch(
    chainKey,
    heights,
    txBytes,
    merkleProofs,
    batch.continuityProof
  )
  console.log(`  verifyBatch() -> ${ok}`)
  if (!ok) throw new Error('the precompile rejected the batch it built for us')

  writeFileSync(
    join(ROOT, 'proof-batch.json'),
    JSON.stringify(
      { chainKey, heights, txBytes, merkleProofs, continuityProof: batch.continuityProof, logIndexes },
      null,
      2
    ) + '\n'
  )
  console.log('\nsaved to proof-batch.json')
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
