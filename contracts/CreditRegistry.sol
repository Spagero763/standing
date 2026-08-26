// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Attestcoin, INativeQueryVerifier} from "./interfaces/INativeQueryVerifier.sol";
import {TxDecoder} from "./lib/TxDecoder.sol";

/// @notice Builds a borrower's repayment record on Creditcoin out of loan
/// repayments they actually made on another chain.
///
/// Nothing here is asserted by the caller. Every entry is a transaction that
/// Attestcoin proved was included in an attested block, decoded on chain.
contract CreditRegistry is Ownable2Step, ReentrancyGuard {
    using TxDecoder for TxDecoder.Receipt;

    /// @dev A lending market we are willing to count, described rather than hardcoded
    /// so a new lender is a configuration change and not a redeploy.
    struct Market {
        bool enabled;
        /// topic0 of the event that signals a repayment.
        bytes32 repayTopic;
        /// Which indexed topic carries the borrower. 1 to 3.
        uint8 borrowerTopic;
        /// Which 32 byte word of the log body carries the amount.
        uint8 amountWord;
        /// Purely descriptive, surfaced to the frontend.
        string name;
    }

    struct Standing {
        uint64 repayments;
        uint64 firstHeight;
        uint64 lastHeight;
        uint32 markets;
        uint256 totalRepaid;
    }

    mapping(uint64 chainKey => mapping(address pool => Market)) public markets;
    mapping(address borrower => Standing) private _standing;

    /// @dev One claim per log, so a transaction carrying two repayments counts twice
    /// and the same one never counts twice.
    mapping(bytes32 claimId => bool) public claimed;

    mapping(address borrower => mapping(uint64 chainKey => mapping(address pool => bool)))
        private _seenMarket;

    event MarketSet(uint64 indexed chainKey, address indexed pool, bytes32 repayTopic, string name);
    event MarketDisabled(uint64 indexed chainKey, address indexed pool);
    event RepaymentRecorded(
        address indexed borrower,
        uint64 indexed chainKey,
        address indexed pool,
        uint64 height,
        uint256 amount,
        uint256 score
    );

    error MarketNotAllowed(uint64 chainKey, address pool);
    error TransactionFailedOnSource();
    error NoMatchingRepayment();
    error NotYourRepayment(address borrower);
    error AlreadyClaimed(bytes32 claimId);
    error ProofRejected();
    error BadMarketConfig();
    error AmountOutOfRange();
    error LengthMismatch();
    error NothingToRecord();

    constructor(address owner_) Ownable(owner_) {}

    // --- configuration ---

    function setMarket(
        uint64 chainKey,
        address pool,
        bytes32 repayTopic,
        uint8 borrowerTopic,
        uint8 amountWord,
        string calldata name
    ) external onlyOwner {
        if (pool == address(0) || repayTopic == bytes32(0)) revert BadMarketConfig();
        if (borrowerTopic == 0 || borrowerTopic > 3) revert BadMarketConfig();

        markets[chainKey][pool] = Market({
            enabled: true,
            repayTopic: repayTopic,
            borrowerTopic: borrowerTopic,
            amountWord: amountWord,
            name: name
        });

        emit MarketSet(chainKey, pool, repayTopic, name);
    }

    function disableMarket(uint64 chainKey, address pool) external onlyOwner {
        markets[chainKey][pool].enabled = false;
        emit MarketDisabled(chainKey, pool);
    }

    // --- the one thing this contract does ---

    /// @param chainKey Source chain, as Attestcoin numbers them.
    /// @param height Block on the source chain holding the transaction.
    /// @param encodedTransaction The transaction and its receipt, as attested.
    /// @param logIndex Which log in that receipt is the repayment being claimed.
    function recordRepayment(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof,
        uint256 logIndex
    ) external nonReentrant returns (uint256 score) {
        // Reverts outright on a bad proof. The bool is belt and braces.
        bool proven = Attestcoin.verifier().verifyAndEmit(
            chainKey, height, encodedTransaction, merkleProof, continuityProof
        );
        if (!proven) revert ProofRejected();

        _apply(chainKey, height, encodedTransaction, logIndex);
        return scoreOf(msg.sender);
    }

    /// @notice Proves a whole repayment history at once.
    ///
    /// The blocks share one continuity proof, so a borrower arriving with years
    /// of Aave activity settles it in a single transaction rather than one per
    /// repayment. Every check below is the same as the single path, because it
    /// is literally the same code.
    ///
    /// @param logIndexes Which log in each receipt is the repayment being claimed.
    function recordRepayments(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof,
        uint256[] calldata logIndexes
    ) external nonReentrant returns (uint256 score) {
        uint256 count = heights.length;
        if (count == 0) revert NothingToRecord();
        if (
            encodedTransactions.length != count ||
            merkleProofs.length != count ||
            logIndexes.length != count
        ) revert LengthMismatch();

        bool proven = Attestcoin.verifier().verifyAndEmit(
            chainKey, heights, encodedTransactions, merkleProofs, sharedContinuityProof
        );
        if (!proven) revert ProofRejected();

        for (uint256 i = 0; i < count; i++) {
            _apply(chainKey, heights[i], encodedTransactions[i], logIndexes[i]);
        }

        return scoreOf(msg.sender);
    }

    /// @dev Everything that happens once a proof has held. Shared by both entry
    /// points so the two can never drift apart.
    function _apply(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        uint256 logIndex
    ) private {
        (, TxDecoder.Common memory common, TxDecoder.Receipt memory receipt) =
            TxDecoder.decode(encodedTransaction);

        // A reverted transaction repaid nothing.
        if (!receipt.succeeded()) revert TransactionFailedOnSource();

        Market memory market = markets[chainKey][common.to];
        if (!market.enabled) revert MarketNotAllowed(chainKey, common.to);

        if (logIndex >= receipt.logs.length) revert NoMatchingRepayment();
        TxDecoder.EvmLog memory entry = receipt.logs[logIndex];

        // The log has to come from the pool itself, not merely sit in the same
        // transaction as one. Otherwise any contract could emit a lookalike.
        if (entry.addr != common.to) revert NoMatchingRepayment();
        if (entry.topics.length <= market.borrowerTopic) revert NoMatchingRepayment();
        if (entry.topics[0] != market.repayTopic) revert NoMatchingRepayment();

        address borrower = address(uint160(uint256(entry.topics[market.borrowerTopic])));

        // Third parties are allowed to repay your loan on Ethereum, so the credit
        // follows the borrower named in the event and only they can claim it.
        if (borrower != msg.sender) revert NotYourRepayment(borrower);

        bytes32 claimId = keccak256(
            abi.encode(chainKey, height, keccak256(encodedTransaction), logIndex)
        );
        if (claimed[claimId]) revert AlreadyClaimed(claimId);
        claimed[claimId] = true;

        uint256 amount = _readAmount(entry.data, market.amountWord);

        Standing storage s = _standing[borrower];
        if (s.repayments == 0 || height < s.firstHeight) s.firstHeight = height;
        if (height > s.lastHeight) s.lastHeight = height;
        s.repayments += 1;
        s.totalRepaid += amount;

        if (!_seenMarket[borrower][chainKey][common.to]) {
            _seenMarket[borrower][chainKey][common.to] = true;
            s.markets += 1;
        }

        emit RepaymentRecorded(borrower, chainKey, common.to, height, amount, scoreOf(borrower));
    }

    // --- reading ---

    function standingOf(address borrower) external view returns (Standing memory) {
        return _standing[borrower];
    }

    /// @notice Deliberately simple and readable. A score nobody can explain is a
    /// score nobody should lend against.
    function scoreOf(address borrower) public view returns (uint256) {
        Standing memory s = _standing[borrower];
        if (s.repayments == 0) return 0;

        // Ethereum blocks land about every 12 seconds, so height spread is a
        // provable stand-in for how long this borrower has been repaying.
        uint256 blocksActive = s.lastHeight - s.firstHeight;
        uint256 daysActive = (blocksActive * 12) / 1 days;

        uint256 raw = (uint256(s.repayments) * 40) + (daysActive * 2) + (uint256(s.markets) * 50);
        return raw > 1000 ? 1000 : raw;
    }

    function hasClaimed(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        uint256 logIndex
    ) external view returns (bool) {
        return claimed[
            keccak256(abi.encode(chainKey, height, keccak256(encodedTransaction), logIndex))
        ];
    }

    // --- internals ---

    function _readAmount(bytes memory body, uint8 wordIndex) private pure returns (uint256 amount) {
        uint256 offset = (uint256(wordIndex) + 1) * 32;
        if (body.length < offset) revert AmountOutOfRange();
        assembly {
            amount := mload(add(body, offset))
        }
    }
}
