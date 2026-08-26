# Demo video script

Target length 2:30. Nothing staged, nothing faked. Every number spoken is on
chain and can be checked while the video plays.

## Before you record

Reset the line so the draw is live:

```
npx hardhat run scripts/reset-line.ts --network creditcoinTestnet
```

Have these open as tabs, in this order:

1. `http://localhost:3000`
2. Aave's repayment on Sepolia: `sepolia.etherscan.io/tx/0xf7e43379158c55e9a00773b98b5a0344ddcf79a5bbac32ffe32a5b3440a0279f`
3. The batch on Blockscout: `creditcoin-testnet.blockscout.com/tx/0x2762260262f4a76a6cf0d912e9b59b855b2171e446b778c449d3008526c834cb`
4. A terminal in the project root

Record at 1920x1080. Keep the cursor still while talking.

---

## 0:00 to 0:22 &middot; The problem

**Screen:** the site, hero filling the frame.

> A borrower who has repaid loans on Ethereum for two years arrives on any other
> chain as a complete stranger. Their record is real, it is public, and it is
> worth nothing to them anywhere else.
>
> So every chain makes them post collateral again, against risk that has already
> been proven away.

---

## 0:22 to 0:45 &middot; What it does

**Screen:** scroll slowly to the proof pipeline. Let one replay run.

> Standing imports that history instead of rebuilding it.
>
> You repay on a real money market. Attestcoin proves the block. Creditcoin
> verifies that proof inside the same transaction that acts on it. Only then does
> the score move, and a credit line opens against it with nothing posted.

---

## 0:45 to 1:25 &middot; The proof, running

**Screen:** terminal. Run it live.

```
node scripts/prove.js aaveRepay
```

Let the attestation wait scroll. Do not cut it. Speak over it.

> This is a real repayment I made on Aave V3 on Sepolia. The script is waiting
> for Attestcoin's attestors to sign the block that contains it.

When the proof prints, read the screen.

> There it is. Three and a half kilobytes of transaction, eight Merkle siblings,
> and a continuity proof. And then the important line.

**Screen:** highlight `verify() -> true`.

> That came back from the precompile at 0x0FD2, on Creditcoin, checking a
> transaction that happened on Ethereum. No bridge, no oracle, no committee.

---

## 1:25 to 1:55 &middot; The part nobody else has

**Screen:** switch to the Aave transaction on Etherscan. Point at the `Repay`
event and the pool address.

> Now the thing I would look at hardest if I were judging this.
>
> Most cross-chain proof demos verify an event the team emitted from a contract
> they deployed themselves. Both ends written by the same hand. That proves the
> plumbing and nothing about the world.
>
> This is Aave's pool. Aave's event. Aave's accounting. I did not deploy it and I
> cannot influence it.

**Screen:** back to the site, footer links showing Aave V3 and Compound V3.

> And it reads Compound too. Compound has no repay event at all, it signals a
> repayment with Supply, and the log body is a different shape entirely.
>
> Adding it took one transaction and no contract change, because a market here is
> configuration, not code.

---

## 1:55 to 2:15 &middot; What it refuses

**Screen:** terminal, `npx hardhat test`. Let the list scroll.

> Proving a transaction happened does not prove it was yours. So the contract
> refuses four things.
>
> A reverted transaction. A pool that was never registered. A lookalike event
> emitted by some other contract in the same transaction. And anyone claiming a
> repayment that names someone else as the borrower, which matters because Aave
> lets third parties repay your loan.

**Screen:** stop on the passing count.

> Forty tests. Those four are among them.

---

## 2:15 to 2:35 &middot; Live, and the ask

**Screen:** the site, connected wallet, standing panel visible.

> On chain right now: four proven repayments across two real money markets, a
> score of 260, and a credit line drawn against no collateral at all.
>
> There is no price oracle anywhere in this system, so there is no feed to
> manipulate and nothing to liquidate.

**Screen:** click **Draw**. Let the wallet prompt appear and confirm.

> Creditcoin already has the thesis. Millions of loan transactions, on chain,
> going back years. Attestcoin is what finally lets that history be imported
> rather than rebuilt.
>
> That is Standing.

---

## Notes

- If the attestation wait runs long, cut the middle of it but leave the start and
  the finish so it is visibly real. Do not cut to a finished result.
- Do not read the addresses aloud. They are on screen and in the repository.
- The draw at the end must be a real transaction. If the line has no headroom,
  run `reset-line.ts` again before recording.
- If you overrun, cut the second half of section 1:55. The four refusals can be
  summarised as "four checks, all tested" without losing the argument.
