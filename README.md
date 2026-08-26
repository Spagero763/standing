# Standing

Credit history that travels between chains, proven rather than claimed.

Repay a loan on Ethereum. Prove that repayment on Creditcoin. Borrow against it
with nothing posted as collateral.

## The problem

A borrower who has repaid faithfully on Ethereum for two years arrives on another
chain as a complete stranger. Their history is real, it is public, and it is
useless to them anywhere else. The usual answers are an oracle you have to trust,
a bridge you have to trust, or a self-reported score that means nothing.

## What this does instead

Creditcoin's Attestcoin precompile can prove that a specific transaction was
included in an attested block on another chain, synchronously, inside the same
transaction that acts on the result. No bridge, no oracle committee, no callback.

`CreditRegistry` uses that to build a repayment record nobody can fabricate.
`CreditLine` lends against the record.

## Chain of custody

Every link is either cryptographically proven or enforced on chain.

| Step | Where | What holds it up |
| --- | --- | --- |
| Loan repaid | Ethereum | An ordinary transaction, unaware this exists |
| Block attested | Attestcoin | Independent attestors sign the source block |
| Proof assembled | Proof service | Merkle inclusion plus a continuity proof |
| Proof verified | Creditcoin `0x0FD2` | Precompile checks it, reverts if it fails |
| Score updated | `CreditRegistry` | Only after verification returns |
| Credit drawn | `CreditLine` | Sized from the score, no collateral |

## What the contracts refuse

The registry decodes the attested transaction and enforces four independent
checks. Each one is a test in [`test/CreditRegistry.test.ts`](test/CreditRegistry.test.ts).

- **The receipt must show success.** A reverted transaction repaid nothing.
- **The counterparty must be a registered market.** You cannot pay yourself and
  call it credit.
- **The log must come from the pool itself.** Otherwise any contract could emit a
  lookalike `Repay` event in the same transaction and mint a history out of thin
  air.
- **The claimant must be the borrower named in the event.** Not the transaction
  sender. Third parties are allowed to repay your loan on Ethereum, and using
  `tx.from` would hand your credit record to whoever settled it for you.

Replay is prevented per log rather than per transaction, so one transaction
carrying two genuine repayments counts twice and the same one never counts twice.

## On the lending side

There is deliberately **no price oracle**. The pool lends the single asset it
holds and sizes loans from proven history, so there is no feed to manipulate,
nothing to liquidate and no cascade to trigger. An overdue loan freezes the line
until it is settled. Repayment stays open while the pool is paused, so nobody is
ever trapped in a position.

## Markets are configuration

A lending market is registered as `(chainKey, pool, repayTopic, borrowerTopic,
amountWord)`. Supporting Morpho or Compound is a transaction, not a redeploy.

This is demonstrated rather than claimed. **Aave V3 on Sepolia is registered and
read directly**, at `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`. Adding it took
one `setMarket` call and no contract changes. A repayment made through Aave's own
pool, emitting Aave's own event, is proven and credited exactly like any other.

## Deployed

**Creditcoin testnet** (chain `102031`)

| Contract | Address |
| --- | --- |
| CreditRegistry | `0xF2062F5E7680d1ABfD194af9379C911328634359` |
| CreditLine | `0xB5Ba9B0ab4c88d05B9aeA60C1BE0A31deAb80cb5` |
| TestUSD | `0xD5148E2AF779A90927dfd98a7F888291739915d3` |

**Sepolia** (chain `11155111`, attested as chain key `1`)

| Contract | Address |
| --- | --- |
| Aave V3 Pool (theirs, read by us) | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` |
| DemoLendingPool | `0x1da0c2F508266c60dCAB149bb24a206eeD329ec5` |

## A real run, against Aave

Supply LINK to Aave V3 on Sepolia, borrow DAI, repay DAI, then prove that
repayment on Creditcoin.

```
repay DAI    ok  0xf7e4337915  gas 182932
block        11569138
Repay at     5
reserve      0xff34b3d4...  (DAI)
user         0x1e3a27a2...

latest attested height: 11569130
waiting... attested.

txBytes      3552 bytes
merkle root  0x6d411566116bf35fef27dbf68e4fe72bb5933f6c660c7b34fbee200be0dc4ea7
siblings     7

verify() -> true

  to     0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
  amount 2500000000000000000

  repayments  2
  markets     2
  score       90 -> 180
```

The score then sized a credit line of 180,000 with nothing posted against it.

## Running it

```
npm install
npm test                 # 30 tests
npx hardhat compile
```

The tests install a stand-in for the precompile at its real address with
`hardhat_setCode`, so the contracts are exercised through exactly the call they
make in production rather than a rewired one.

Against a live network:

```
npx hardhat run scripts/deploy.ts        --network creditcoinTestnet
npx hardhat run scripts/deploy-line.ts   --network creditcoinTestnet
```

Against Aave V3 on Sepolia:

```
node scripts/aave-reserves.js        # which reserves have headroom
node scripts/aave-flow.js            # supply, borrow, repay on Aave
node scripts/prove.js aaveRepay      # attest, build the proof, verify it

$env:PROOF_FILE="proof-aaveRepay.json"; $env:POOL_KEY="AaveV3Pool"; $env:MARKET_NAME="Aave V3"
npx hardhat run scripts/settle.ts --network creditcoinTestnet
```

Against the bundled demo pool instead:

```
npx hardhat run scripts/deploy-source.ts --network sepolia
node    scripts/prove.js
npx hardhat run scripts/settle.ts        --network creditcoinTestnet
```

Interface:

```
cd web && npm install && npm run dev
```

## Layout

```
contracts/
  CreditRegistry.sol      proven repayment history
  CreditLine.sol          uncollateralised lending against it
  lib/TxDecoder.sol       reads the attested transaction
  interfaces/             the precompile, transcribed from its ABI
  source/                 what runs on the source chain
scripts/                  deploy, prove, settle
test/                     30 tests
web/                      interface
```
