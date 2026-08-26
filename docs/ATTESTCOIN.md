# Attestcoin Protocol Integration

How Standing uses the Attestcoin Protocol, what it asks of it, and what it
deliberately does not trust.

Attestcoin is not a component here. It is the reason the product can exist. Take
it away and there is no way to know that a repayment on another chain happened,
which means there is no credit record and nothing to lend against.

## The surface we use

| Piece | Address | What we call |
| --- | --- | --- |
| Block prover precompile | `0x0000000000000000000000000000000000000FD2` | `verifyAndEmit` single and batch |
| Chain info precompile | `0x0000000000000000000000000000000000000FD3` | attestation height, continuity bounds |
| Proof builder service | `proof-gen-api.cc3-testnet.creditcoin.network` | `getProof`, `getBatchProof` |
| SDK | `@gluwa/usc-sdk` 0.18.0 | providers, encoding, batch assembly |

Source chain is Ethereum Sepolia, attested as chain key `1`. Creditcoin CC3
testnet is chain `102031`.

The precompile interface is transcribed directly from the ABI shipped with the
SDK into [`contracts/interfaces/INativeQueryVerifier.sol`](../contracts/interfaces/INativeQueryVerifier.sol)
rather than reconstructed by hand.

## Why the call is made from inside the contract

The SDK can verify a proof from TypeScript. We do not do that, because a proof
verified off chain and then reported to a contract is just an oracle with extra
steps.

`CreditRegistry.recordRepayment` calls the precompile itself:

```solidity
bool proven = Attestcoin.verifier().verifyAndEmit(
    chainKey, height, encodedTransaction, merkleProof, continuityProof
);
if (!proven) revert ProofRejected();
```

Verification and the state change it authorises are the same transaction. A bad
proof reverts the write along with it. There is no window in which the contract
believes something unproven, and no privileged reporter anywhere in the design.

The precompile reverts on a failed proof rather than returning false, so the
boolean check is redundant. It is kept because relying on a dependency's revert
behaviour is a worse habit than checking a return value, and because
[`test/CreditRegistry.test.ts`](../test/CreditRegistry.test.ts) exercises a
verifier that returns `false` without reverting, which the revert alone would
not catch.

## Reading the attested transaction

`verify` proves inclusion. It does not tell you what the transaction did. To
build a credit record we have to decode the payload the precompile just vouched
for.

The layout is not documented. We derived it empirically, by running the SDK's
own encoder against live Sepolia transactions and decoding the output until it
matched what the node reported. That work is preserved in
[`scripts/verify-layout.js`](../scripts/verify-layout.js), which still runs and
still cross-checks.

The shape is:

```
abi.encode(uint8 txType, bytes[3] groups)

groups[0]  common     (uint64 nonce, uint64 gasLimit, address from, bool toIsNull,
                       address to, uint256 value, bytes data)
groups[1]  type specific, varies between legacy and EIP-1559
groups[2]  receipt    (uint8 status, uint64 gasUsed,
                       (address,bytes32[],bytes)[] logs, bytes logsBloom)
```

[`contracts/lib/TxDecoder.sol`](../contracts/lib/TxDecoder.sol) reads groups 0
and 2 only. Those two are identical across every transaction type, so nothing in
the registry depends on which type it was handed.

Two notes worth recording, because both cost time:

- The groups are **flat encodings of their fields**, not single dynamic tuples.
  `abi.decode(group, (Common))` expects a leading offset that is not there and
  reverts. Fields must be decoded individually.
- The SDK ships no Solidity, and the `EvmV1Decoder` the documentation mentions
  has no published address. Deriving the layout removed that dependency
  entirely. Plain `abi.decode` is enough.

## What the contract refuses

Proof of inclusion means the transaction happened. It does not mean the caller
is entitled to credit for it. Four further checks run on the decoded payload,
each with a test:

1. **`receipt.status` must be 1.** A reverted transaction repaid nothing.
2. **`common.to` must be a registered market.** Otherwise you could pay yourself
   through a contract you wrote and call it credit history.
3. **The log must originate from that market address.** Without this, any
   contract could emit a lookalike `Repay` in the same transaction and mint a
   history out of nothing. This is the sharpest attack against the design and it
   is covered by `refuses a lookalike event emitted by some other contract`.
4. **The claimant must be the borrower named in the event**, not the transaction
   sender. Aave permits third parties to repay your loan. Using `tx.from` would
   assign your credit record to whoever settled it for you.

Replay is keyed on `(chainKey, height, keccak256(encodedTransaction), logIndex)`,
so one transaction carrying two genuine repayments counts twice and the same one
never counts twice.

## Markets are configuration

A market is registered as `(chainKey, pool, repayTopic, borrowerTopic, amountWord)`.
Nothing about any protocol is compiled in.

This is demonstrated against two independent money markets that we did not
write, with different event signatures:

| Market | Address on Sepolia | Repayment signal |
| --- | --- | --- |
| Aave V3 | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` | `Repay(address,address,address,uint256,bool)` |
| Compound V3 | `0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e` | `Supply(address,address,uint256)` |

Compound has no distinct repay event. Supplying the base asset against a debt is
the repayment, and the log body is a bare `uint256` where Aave's is
`(uint256, bool)`. Adding it required one `setMarket` transaction and no contract
change, because the registry reads a word index rather than a decoded shape.

## Batch proving

A borrower arriving with real history has many repayments, not one.

`recordRepayments` takes many heights, many encoded transactions, many Merkle
proofs and **one shared continuity proof**, which is what the batch precompile
overload accepts. The proof service assembles it in one call via `getBatchProof`.

Measured on three real Aave repayments in consecutive Sepolia blocks:

| | Gas |
| --- | --- |
| Three, batched | 392,420 total, 130,806 each |
| One, alone | 190,050 |

A 31% saving per repayment, and one signature instead of three.

Both entry points call the same `_apply` internal function, so the single and
batch paths cannot drift apart in what they enforce. A batch is all or nothing:
if any entry fails any check, the whole transaction reverts and nothing is
written, including the entries that would have passed.

## Attestation timing

Blocks are not immediately provable. `PrecompileChainInfoProvider` reports the
latest attested height and the continuity bounds around a target, and
`waitUntilHeightAttested` blocks until the source block is covered. In practice
we observed lags of roughly 2 to 12 blocks on Sepolia.

`getContinuityBounds` is worth calling before requesting a proof, since it says
whether the height sits inside an attested range rather than merely below the
latest attested height.

## Reproducing it

```
node scripts/aave-flow.js               # borrow and repay on real Aave V3
node scripts/aave-history.js            # build a multi repayment history
node scripts/prove.js aaveRepay         # attest, prove, verify one
node scripts/prove-batch.js             # attest, prove, verify a whole history
node scripts/comet-flow.js              # borrow and repay on real Compound V3
node scripts/verify-layout.js           # re-derive the encoding, cross checked

npx hardhat run scripts/settle-batch.ts --network creditcoinTestnet
```

Supporting checks: `scripts/aave-reserves.js` reports which reserves have supply
headroom, and `scripts/comet-check.js` reports Comet's base asset and collateral
set. Both exist because the first attempts failed against caps and missing
faucets, and the answers are worth keeping.

## What Attestcoin is not asked to do

It is not asked what a transaction meant, only that it happened. Everything about
meaning, which pool, which event, which participant, which field, is enforced by
the registry against the decoded payload and is visible in the tests.

It is also not asked for prices. There is no oracle anywhere in this system. The
credit line lends the one asset it holds and sizes loans from proven history, so
there is no feed to manipulate, nothing to liquidate and no cascade to trigger.
