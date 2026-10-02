// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice WORLD V2: zero initial supply, permanent Core minting and approved war burns.
contract WorldTokenBSCV2 is ERC20 {
    error InvalidCore();
    error UnauthorizedMinter(address caller);
    error UnauthorizedBurner(address caller);

    address public immutable core;

    constructor(address core_) ERC20("WORLD", "WORLD") {
        // The factory binds the future Core before CREATE #2 deploys its code.
        if (core_ == address(0)) revert InvalidCore();
        core = core_;
    }

    /// @dev The immutable Core verifies full BNB payment before every mint.
    function mint(address to, uint256 amount) external {
        if (msg.sender != core) revert UnauthorizedMinter(msg.sender);
        _mint(to, amount);
    }

    /// @notice Voluntarily burn your own WORLD; no LAND or reward is created.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice War burn, callable only by Core and subject to the holder's allowance.
    /// @dev Finite allowances decrease; uint256.max retains standard infinite approval semantics.
    function burnFrom(address account, uint256 amount) external {
        if (msg.sender != core) revert UnauthorizedBurner(msg.sender);
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }
}
