// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice A small lending pool that lives on the source chain and emits the
/// same Repay signature Aave V3 does, so the registry reads real events from a
/// real pool rather than something shaped specially for it.
///
/// Deployed on Ethereum only. Nothing here runs on Creditcoin.
contract DemoLendingPool {
    using SafeERC20 for IERC20;

    /// @dev Identical signature to Aave V3, deliberately.
    event Borrow(address indexed reserve, address indexed user, uint256 amount);
    event Repay(
        address indexed reserve,
        address indexed user,
        address indexed repayer,
        uint256 amount,
        bool useATokens
    );

    mapping(address reserve => mapping(address user => uint256)) public debtOf;

    error NothingOwed();
    error RepayExceedsDebt(uint256 owed, uint256 offered);

    function borrow(address reserve, uint256 amount) external {
        debtOf[reserve][msg.sender] += amount;
        IERC20(reserve).safeTransfer(msg.sender, amount);
        emit Borrow(reserve, msg.sender, amount);
    }

    /// @param onBehalfOf The borrower whose debt is being cleared. Anyone may pay
    /// it, which is exactly the case the registry has to get right.
    function repay(address reserve, uint256 amount, address onBehalfOf) external {
        uint256 owed = debtOf[reserve][onBehalfOf];
        if (owed == 0) revert NothingOwed();
        if (amount > owed) revert RepayExceedsDebt(owed, amount);

        debtOf[reserve][onBehalfOf] = owed - amount;
        IERC20(reserve).safeTransferFrom(msg.sender, address(this), amount);

        emit Repay(reserve, onBehalfOf, msg.sender, amount, false);
    }
}
