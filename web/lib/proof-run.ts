/**
 * A real run against two independent money markets. Every hash, height and gas
 * figure came off chain, not out of a design file.
 */
export const proofRun = {
  markets: [
    {
      name: 'Aave V3',
      address: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
      event: 'Repay(address,address,address,uint256,bool)',
      repayments: 3,
      blocks: '11569290 to 11569292'
    },
    {
      name: 'Compound V3',
      address: '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e',
      event: 'Supply(address,address,uint256)',
      repayments: 1,
      blocks: '11569361'
    }
  ],
  batch: {
    tx: '0x2762260262f4a76a6cf0d912e9b59b855b2171e446b778c449d3008526c834cb',
    count: 3,
    gasTotal: 392420,
    gasEach: 130806,
    gasSingle: 190050,
    continuityRoots: 11
  },
  compound: {
    sourceTx: '0x7c8320bf5fe8d1864b6e44fc25b4c5e08d18688cc46241a6e2ecc7d41ba3f86d',
    recordTx: '0xedf7b14a161638a4506cbc4cbf7a6ad2c98b106f92d7af7811642d8b660d962b',
    gasUsed: 187026,
    siblings: 8
  },
  outcome: {
    repayments: 4,
    markets: 2,
    score: 260,
    limit: '260000',
    drawTx: '0x90cb2fc176be24afdf94a934bb13b4df4a351eb377f45b1ee44946449eed06a6',
    drawn: '260000',
    collateral: 'none'
  }
} as const

export type Stage = {
  key: string
  title: string
  detail: string
  facts: [string, string][]
  link?: { href: string; label: string }
}

const { batch, compound, outcome } = proofRun

export const stages: Stage[] = [
  {
    key: 'repay',
    title: 'Repaid on Aave and on Compound',
    detail:
      'Two independent money markets we did not write, with entirely different event shapes. Aave signals a repayment with Repay, Compound with Supply. Neither knows Creditcoin exists.',
    facts: [
      ['aave', 'Repay(...)'],
      ['compound', 'Supply(...)'],
      ['repayments', String(outcome.repayments)]
    ],
    link: {
      href: 'https://sepolia.etherscan.io/tx/' + compound.sourceTx,
      label: 'The Compound repayment'
    }
  },
  {
    key: 'attest',
    title: 'Blocks attested',
    detail:
      'Independent attestors sign each source block. Until this lands there is nothing to prove against.',
    facts: [
      ['aave blocks', '11569290 to 11569292'],
      ['compound', '11569361'],
      ['continuity', `${batch.continuityRoots} roots`]
    ]
  },
  {
    key: 'proof',
    title: 'One proof for a whole history',
    detail:
      'Three repayments share a single continuity proof, one Merkle proof each. A borrower arriving with years of history settles it in one transaction instead of one per repayment.',
    facts: [
      ['batched', String(batch.count)],
      ['gas each', batch.gasEach.toLocaleString()],
      ['alone', batch.gasSingle.toLocaleString()]
    ]
  },
  {
    key: 'verify',
    title: 'Verified on Creditcoin',
    detail:
      'The precompile checks every proof inside the same transaction that acts on it. One bad proof reverts the whole batch.',
    facts: [
      ['precompile', '0x0FD2'],
      ['result', 'true'],
      ['gas', batch.gasTotal.toLocaleString()]
    ],
    link: {
      href: 'https://creditcoin-testnet.blockscout.com/tx/' + batch.tx,
      label: 'The batch on Blockscout'
    }
  },
  {
    key: 'credit',
    title: 'Credit unlocked',
    detail:
      'The score moves only after the proofs hold. Adding a second protocol took one transaction and no contract changes, because a market is configuration rather than code.',
    facts: [
      ['score', String(outcome.score)],
      ['markets', String(outcome.markets)],
      ['collateral', outcome.collateral]
    ],
    link: {
      href: 'https://creditcoin-testnet.blockscout.com/tx/' + outcome.drawTx,
      label: 'The loan it funded'
    }
  }
]
