// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {INativeQueryVerifier} from "../interfaces/INativeQueryVerifier.sol";

/// @dev Stands in for the Creditcoin precompile on a local chain. Placed at the
/// real precompile address with hardhat_setCode so the registry is exercised
/// through exactly the call it makes in production.
contract AlwaysVerify is INativeQueryVerifier {
    function verify(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        pure
        returns (bool)
    {
        return true;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata,
        MerkleProof calldata,
        ContinuityProof calldata
    ) external returns (bool) {
        emit TransactionVerified(chainKey, height, 0);
        return true;
    }

    function verifyAndEmit(
        uint64,
        uint64[] calldata,
        bytes[] calldata,
        MerkleProof[] calldata,
        ContinuityProof calldata
    ) external pure returns (bool) {
        return true;
    }
}

/// @dev The precompile reverts on a bad proof. This reproduces that.
contract RevertingVerify is INativeQueryVerifier {
    error BadProof();

    function verify(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        pure
        returns (bool)
    {
        return false;
    }

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        MerkleProof calldata,
        ContinuityProof calldata
    ) external pure returns (bool) {
        revert BadProof();
    }

    function verifyAndEmit(
        uint64,
        uint64[] calldata,
        bytes[] calldata,
        MerkleProof[] calldata,
        ContinuityProof calldata
    ) external pure returns (bool) {
        revert BadProof();
    }
}

/// @dev A precompile that answers false instead of reverting, to prove the
/// registry does not lean solely on the revert.
contract FalseVerify is INativeQueryVerifier {
    function verify(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        pure
        returns (bool)
    {
        return false;
    }

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        MerkleProof calldata,
        ContinuityProof calldata
    ) external pure returns (bool) {
        return false;
    }

    function verifyAndEmit(
        uint64,
        uint64[] calldata,
        bytes[] calldata,
        MerkleProof[] calldata,
        ContinuityProof calldata
    ) external pure returns (bool) {
        return false;
    }
}
