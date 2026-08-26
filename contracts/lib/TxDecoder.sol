// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Reads the transaction blob Attestcoin proves.
///
/// Layout, confirmed against live Sepolia transactions rather than taken on faith:
/// abi.encode(uint8 txType, bytes[] groups) where groups holds three separately
/// encoded field sets. Group 0 is the transaction, group 1 is type specific and
/// varies between legacy and EIP-1559, group 2 is the receipt.
///
/// Only groups 0 and 2 are read here. Their shape is identical across every
/// transaction type, so nothing below depends on which one it was.
library TxDecoder {
    struct EvmLog {
        address addr;
        bytes32[] topics;
        bytes data;
    }

    struct Common {
        uint64 nonce;
        uint64 gasLimit;
        address from;
        bool toIsNull;
        address to;
        uint256 value;
        bytes data;
    }

    struct Receipt {
        uint8 status;
        uint64 gasUsed;
        EvmLog[] logs;
        bytes logsBloom;
    }

    error MalformedTransaction();

    function decode(bytes memory encoded)
        internal
        pure
        returns (uint8 txType, Common memory common, Receipt memory receipt)
    {
        bytes[] memory groups;
        (txType, groups) = abi.decode(encoded, (uint8, bytes[]));
        if (groups.length != 3) revert MalformedTransaction();

        // Each group holds its fields flat, not wrapped as a single tuple, so they
        // are decoded one by one. Decoding straight into the struct would expect a
        // leading offset that is not there.
        (
            common.nonce,
            common.gasLimit,
            common.from,
            common.toIsNull,
            common.to,
            common.value,
            common.data
        ) = abi.decode(groups[0], (uint64, uint64, address, bool, address, uint256, bytes));

        (receipt.status, receipt.gasUsed, receipt.logs, receipt.logsBloom) =
            abi.decode(groups[2], (uint8, uint64, EvmLog[], bytes));
    }

    function succeeded(Receipt memory receipt) internal pure returns (bool) {
        return receipt.status == 1;
    }
}
