# Standing

Credit history that travels between chains, proven rather than claimed.

Repay a loan on Aave or Compound. Prove that repayment on Creditcoin. Borrow
against it with nothing posted as collateral.

**[How the Attestcoin Protocol integration works](docs/ATTESTCOIN.md)** covers the
precompile surface, the transaction encoding, the checks the registry enforces
and the measured gas. Start there if you are here to read the technical detail.

## The problem

A borrower who has repaid faithfully on Ethereum for two years arrives on another
chain as a complete stranger. Their history is real, it is public, and it is
useless to them anywhere else. The usual answers are an oracle you have to trust,
a bridge you have to trust, or a score the borrower reports about themselves.

## What this does instead

Creditcoin's Attestcoin precompile can prove that a specific transaction was
included in an attested block on another chain, synchronously, inside the same
transaction that acts on the result. No bridge, no oracle committee, no callback.

`CreditRegistry` uses that to build a repayment record nobody can fabricate.
`CreditLine` lends against the record.

## It reads markets it did not write

This is the part that matters. Most cross-chain proof demos verify an event the
same team emitted from a contract they deployed, which proves the plumbing and
nothing about the world.

Standing reads two independent money markets on Sepolia:

| Market | Address | Repayment signal |
| --- | --- | --- |
| Aave V3 | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` | `Repay(address,address,address,uint256,bool)` |
| Compound V3 | `0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e` | `Supply(address,address,uint256)` |

Their pools, their events, their accounting. Compound has no distinct repay
event at all, and its log body is a bare `uint256` where Aave's is
`(uint256, bool)`. Adding the second market took **one transaction and no
contract change**, because a market is registered as
`(chainKey, pool, repayTopic, borrowerTopic, amountWord)` rather than compiled in.

## Chain of custody

| Step | Where | What holds it up |
| --- | --- | --- |
| Loan repaid | Ethereum | An ordinary transaction, unaware this exists |
| Block attested | Attestcoin | Independent attestors sign the source block |
| Proof assembled | Proof service | Merkle inclusion plus a continuity proof |
| Proof verified | Creditcoin `0x0FD2` | Precompile checks it, reverts if it fails |
| Score updated | `CreditRegistry` | Only after verification returns |
| Credit drawn | `CreditLine` | Sized from the score, no collateral |

## What the contracts refuse

Inclusion proves a transaction happened. It does not prove the caller is entitled
to credit for it. Four further checks run on the decoded payload, each with a test
in [`test/CreditRegistry.test.ts`](test/CreditRegistry.test.ts).

- **The receipt must show success.** A reverted transaction repaid nothing.
- **The counterparty must be a registered market.** You cannot pay yourself
  through your own contract and call it credit.
- **The log must come from the pool itself.** Otherwise any contract could emit a
  lookalike `Repay` event in the same transaction and mint a history out of thin
  air.
- **The claimant must be the borrower named in the event.** Not the transaction
  sender. Third parties are allowed to repay your loan, and using `tx.from` would
  hand your credit record to whoever settled it for you.

Replay is prevented per log, so one transaction carrying two genuine repayments
counts twice and the same one never counts twice.

## Proving a whole history at once

Real borrowers arrive with many repayments. `recordRepayments` takes many Merkle
proofs against **one shared continuity proof**, measured on three real Aave
repayments in consecutive Sepolia blocks:

| Path | Gas total | Per repayment |
| --- | --- | --- |
| Three, batched | 392,420 | 130,806 |
| One, alone | 190,050 | 190,050 |

A batch is all or nothing. If any entry fails any check the whole transaction
reverts and nothing is written, including entries that would have passed. Both
entry points share one internal path so they cannot drift apart in what they
enforce.

## On the lending side

There is deliberately **no price oracle**. The pool lends the single asset it
holds and sizes loans from proven history, so there is no feed to manipulate,
nothing to liquidate and no cascade to trigger. An overdue loan freezes the line
until it is settled. Repayment stays open while the pool is paused, so nobody is
ever trapped in a position.

## Deployed

**Creditcoin CC3 testnet** (chain `102031`)

| Contract | Address |
| --- | --- |
| CreditRegistry | `0x55a20F3023f379739966e3109f98927813E6CA02` |
| CreditLine | `0x634071a3B31a61881b28E846CE93A86B023eE7e7` |
| TestUSD | `0x2d0108B330680F41FB25caD00b42e1245229f40F` |

**Sepolia** (chain `11155111`, attested as chain key `1`)

| Contract | Address |
| --- | --- |
| Aave V3 Pool (theirs) | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` |
| Compound V3 Comet (theirs) | `0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e` |
| DemoLendingPool (ours, for reproducing) | `0x1da0c2F508266c60dCAB149bb24a206eeD329ec5` |

Current state on chain: **4 proven repayments across 2 real markets, score 260,
credit line of 260,000 drawn against no collateral.**

## Running it

```
npm install
npm test                 # 40 tests
npx hardhat compile
```

The tests install a stand-in for the precompile at its real address with
`hardhat_setCode`, so the contracts are exercised through exactly the call they
make in production rather than a rewired one.

Interface:

```
cd web && npm install && npm run dev
```

Against live networks, see [docs/ATTESTCOIN.md](docs/ATTESTCOIN.md#reproducing-it)
for the full sequence.

## Layout

```
contracts/
  CreditRegistry.sol      proven repayment history, single and batch
  CreditLine.sol          uncollateralised lending against it
  lib/TxDecoder.sol       reads the attested transaction
  interfaces/             the precompile, transcribed from its ABI
  source/                 what runs on the source chain
docs/ATTESTCOIN.md        how the protocol integration works
scripts/                  deploy, prove, settle, and the market probes
test/                     40 tests
web/                      interface
```
