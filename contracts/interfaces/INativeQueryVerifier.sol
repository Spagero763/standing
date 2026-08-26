// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Creditcoin's block prover precompile. Proves that a given transaction
/// was included in a block on a source chain that Attestcoin has attested.
/// Transcribed from the ABI shipped with the gluwa usc-sdk package, version 0.18.0.
interface INativeQueryVerifier {
    struct MerkleProofEntry {
        bytes32 hash;
        bool isLeft;
    }

    struct MerkleProof {
        bytes32 root;
        MerkleProofEntry[] siblings;
    }

    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }

    event TransactionVerified(uint64 indexed chainKey, uint64 indexed height, uint64 transactionIndex);

    /// @dev View path. Returns false rather than reverting when the proof does not hold.
    function verify(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external view returns (bool);

    /// @dev State changing path. Reverts on a bad proof and emits TransactionVerified on success.
    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool);

    function verifyAndEmit(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        MerkleProof[] calldata merkleProofs,
        ContinuityProof calldata sharedContinuityProof
    ) external returns (bool);
}

library Attestcoin {
    address internal constant VERIFIER = 0x0000000000000000000000000000000000000FD2;

    function verifier() internal pure returns (INativeQueryVerifier) {
        return INativeQueryVerifier(VERIFIER);
    }
}
