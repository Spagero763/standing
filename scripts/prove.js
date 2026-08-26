/**
 * The real pipeline: take the repayment that happened on Sepolia, wait for
 * Attestcoin to attest its block, pull the proof, and have the live precompile
 * verify it. No mocks anywhere in this path.
 */
const { JsonRpcProvider, Network } = require('ethers')
const { chainInfo, blockProver, proofProvider } = require('@gluwa/usc-sdk')
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const ROOT = join(__dirname, '..')

function env(key, fallback) {
  const line = readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + '='))
  return line ? line.slice(key.length + 1) : fallback
}

async function main() {
  // Which recorded repayment to prove. `aaveRepay` is the one from the real
  // Aave V3 pool, `lastRepay` the one from our own.
  const which = process.argv[2] ?? 'lastRepay'
  const deployments = JSON.parse(readFileSync(join(ROOT, 'deployments.json'), 'utf8'))
  const repay = deployments.sepolia?.[which]
  if (!repay) throw new Error(`no repayment recorded under sepolia.${which}`)
  console.log(`proving sepolia.${which}\n`)

  const chainKey = parseInt(env('SOURCE_CHAIN_KEY', '1'))
  const creditcoin = new JsonRpcProvider(
    env('CREDITCOIN_RPC_URL'),
    Network.from(102031),
    { staticNetwork: true }
  )

  const info = new chainInfo.PrecompileChainInfoProvider(creditcoin)

  console.log('--- supported source chains ---')
  const chains = await info.getSupportedChains()
  for (const c of chains) {
    console.log(`  key ${c.chainKey}  chainId ${c.chainId}  ${c.chainName}  encoding ${c.chainEncoding}`)
  }

  const mine = chains.find((c) => c.chainKey === chainKey)
  console.log(`\nusing chain key ${chainKey} -> ${mine ? mine.chainName : 'NOT SUPPORTED'}`)
  if (!mine) throw new Error(`chain key ${chainKey} is not attested by this network`)
  if (mine.chainId !== 11155111) {
    console.log(`  WARNING: chain key ${chainKey} is chainId ${mine.chainId}, not Sepolia`)
  }

  const latest = await info.getLatestAttestedHeightAndHash(chainKey)
  console.log(`\nlatest attested height: ${latest.exists ? latest.height : 'none'}`)
  console.log(`our repayment block:    ${repay.block}`)
  console.log(`gap:                    ${latest.exists ? latest.height - repay.block : 'n/a'}`)

  if (!latest.exists || latest.height < repay.block) {
    console.log('\nnot attested yet. waiting...')
    await info.waitUntilHeightAttested(chainKey, repay.block, 5000, 15 * 60 * 1000, 15000)
    console.log('attested.')
  } else {
    console.log('\nalready attested.')
  }

  const bounds = await info.getContinuityBounds(chainKey, repay.block)
  console.log(`\ncontinuity bounds: ${bounds.parentHeight} .. ${bounds.childHeight} (isAttested ${bounds.isAttested})`)

  console.log('\n--- requesting proof ---')
  const builder = new proofProvider.service.ProofBuilder(chainKey, env('CREDITCOIN_PROOF_BUILDER_URL'))
  const result = await builder.getProof(repay.hash)

  if (!result.success || !result.data) {
    throw new Error(`proof generation failed: ${JSON.stringify(result.error)}`)
  }

  const proof = result.data
  console.log(`  chainKey     ${proof.chainKey}`)
  console.log(`  headerNumber ${proof.headerNumber}`)
  console.log(`  txBytes      ${(proof.txBytes.length - 2) / 2} bytes`)
  console.log(`  merkle root  ${proof.merkleProof.root}`)
  console.log(`  siblings     ${proof.merkleProof.siblings.length}`)
  console.log(`  continuity   ${proof.continuityProof.roots.length} roots`)

  console.log('\n--- verifying against the live precompile ---')
  const prover = new blockProver.PrecompileBlockProver(creditcoin)
  const verified = await prover.verifySingle(
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof,
    proof.continuityProof
  )
  console.log(`  verify() -> ${verified}`)
  if (!verified) throw new Error('the precompile rejected a proof it generated for us')

  const txIndex = await prover.computeTransactionIndex(proof.merkleProof)
  console.log(`  transaction index in block: ${txIndex}`)

  const out = which === 'lastRepay' ? 'proof.json' : `proof-${which}.json`
  writeFileSync(
    join(ROOT, out),
    JSON.stringify(
      {
        chainKey: proof.chainKey,
        height: proof.headerNumber,
        txBytes: proof.txBytes,
        merkleProof: proof.merkleProof,
        continuityProof: proof.continuityProof,
        sourceTx: repay.hash,
        logIndex: repay.logIndex
      },
      null,
      2
    ) + '\n'
  )
  console.log(`\nproof saved to ${out}`)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
