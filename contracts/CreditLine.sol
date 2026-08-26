// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {CreditRegistry} from "./CreditRegistry.sol";

/// @notice Lends against a repayment record proven on another chain, with no
/// collateral behind it.
///
/// There is deliberately no price oracle here. The pool lends the one asset it
/// holds and sizes the loan from the borrower's proven history, so there is no
/// feed to manipulate, nothing to liquidate, and no cascade to trigger. The
/// credit risk is real and it is the point.
contract CreditLine is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    CreditRegistry public immutable registry;

    struct Loan {
        uint256 principal;
        uint64 since;
        uint64 dueAt;
    }

    mapping(address borrower => Loan) private _loans;

    /// @notice What a borrower at the top of the scale may draw.
    uint256 public ceiling;
    /// @notice Simple annual rate in basis points.
    uint16 public rateBps;
    /// @notice How long a draw runs before it counts as overdue.
    uint64 public term;

    uint256 private constant SCORE_MAX = 1000;
    uint256 private constant YEAR = 365 days;

    event TermsSet(uint256 ceiling, uint16 rateBps, uint64 term);
    event Drawn(address indexed borrower, uint256 amount, uint256 owed, uint64 dueAt);
    event Repaid(address indexed borrower, uint256 amount, uint256 remaining);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error NoCreditAvailable(uint256 limit, uint256 owed);
    error ExceedsLimit(uint256 requested, uint256 available);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error Overdue(uint64 dueAt);
    error NothingOwed();
    error ZeroAmount();
    error BadTerms();

    constructor(address owner_, IERC20 asset_, CreditRegistry registry_) Ownable(owner_) {
        if (address(asset_) == address(0) || address(registry_) == address(0)) revert BadTerms();
        asset = asset_;
        registry = registry_;

        ceiling = 1_000_000;
        rateBps = 500;
        term = 30 days;
    }

    // --- terms ---

    function setTerms(uint256 ceiling_, uint16 rateBps_, uint64 term_) external onlyOwner {
        if (term_ == 0 || rateBps_ > 5_000) revert BadTerms();
        ceiling = ceiling_;
        rateBps = rateBps_;
        term = term_;
        emit TermsSet(ceiling_, rateBps_, term_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused_ ? _pause() : _unpause();
    }

    // --- liquidity ---

    function fund(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        asset.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function available() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    // --- borrowing ---

    /// @notice The most this borrower may owe at once, straight off their proven record.
    function limitOf(address borrower) public view returns (uint256) {
        uint256 score = registry.scoreOf(borrower);
        if (score == 0) return 0;

        // An overdue loan freezes the line until it is cleared.
        Loan memory loan = _loans[borrower];
        if (loan.principal > 0 && block.timestamp > loan.dueAt) return 0;

        return (ceiling * score) / SCORE_MAX;
    }

    function owedBy(address borrower) public view returns (uint256) {
        Loan memory loan = _loans[borrower];
        if (loan.principal == 0) return 0;
        return loan.principal + _interest(loan.principal, block.timestamp - loan.since);
    }

    function loanOf(address borrower) external view returns (Loan memory) {
        return _loans[borrower];
    }

    function draw(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        Loan storage loan = _loans[msg.sender];
        if (loan.principal > 0 && block.timestamp > loan.dueAt) revert Overdue(loan.dueAt);

        uint256 limit = limitOf(msg.sender);
        uint256 owed = _capitalise(loan);
        if (limit == 0) revert NoCreditAvailable(limit, owed);

        uint256 headroom = limit > owed ? limit - owed : 0;
        if (amount > headroom) revert ExceedsLimit(amount, headroom);

        uint256 liquidity = available();
        if (amount > liquidity) revert InsufficientLiquidity(amount, liquidity);

        loan.principal = owed + amount;
        loan.dueAt = uint64(block.timestamp) + term;

        emit Drawn(msg.sender, amount, loan.principal, loan.dueAt);
        asset.safeTransfer(msg.sender, amount);
    }

    function repay(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        Loan storage loan = _loans[msg.sender];
        if (loan.principal == 0) revert NothingOwed();

        uint256 owed = _capitalise(loan);
        uint256 paid = amount > owed ? owed : amount;

        loan.principal = owed - paid;
        if (loan.principal == 0) {
            loan.since = 0;
            loan.dueAt = 0;
        }

        emit Repaid(msg.sender, paid, loan.principal);
        asset.safeTransferFrom(msg.sender, address(this), paid);
    }

    // --- internals ---

    /// @dev Rolls accrued interest into principal and restarts the clock.
    function _capitalise(Loan storage loan) private returns (uint256 owed) {
        if (loan.principal == 0) {
            loan.since = uint64(block.timestamp);
            return 0;
        }
        owed = loan.principal + _interest(loan.principal, block.timestamp - loan.since);
        loan.principal = owed;
        loan.since = uint64(block.timestamp);
    }

    function _interest(uint256 principal, uint256 elapsed) private view returns (uint256) {
        return (principal * rateBps * elapsed) / (10_000 * YEAR);
    }
}
