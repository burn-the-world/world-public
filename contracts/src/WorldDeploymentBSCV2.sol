// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {WorldTokenBSCV2} from "./WorldTokenBSCV2.sol";
import {WorldCoreBSCV2} from "./WorldCoreBSCV2.sol";
import {WorldLandProfileBSCV2} from "./WorldLandProfileBSCV2.sol";

/// @notice Atomically create one new, permanently bound BSC Burn + Resistance V2 world.
/// @dev The deployed factory exposes only the three immutable address getters.
contract WorldDeploymentBSCV2 {
    error InvalidBinding();

    WorldTokenBSCV2 public immutable token;
    WorldCoreBSCV2 public immutable core;
    WorldLandProfileBSCV2 public immutable profile;

    event WorldDeployed(address indexed token, address indexed core, address indexed profile);

    constructor() {
        // CREATE #1 = Token; CREATE #2 = Core. RLP([this, 2]) = d6 94 <this> 02.
        address expectedCore = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", address(this), hex"02")))));
        WorldTokenBSCV2 token_ = new WorldTokenBSCV2(expectedCore);
        WorldCoreBSCV2 core_ = new WorldCoreBSCV2(token_);

        if (
            address(core_) != expectedCore || token_.core() != address(core_)
                || address(core_.token()) != address(token_) || token_.totalSupply() != 0
                || token_.decimals() != 18 || core_.TOKEN_UNIT() != 1e18 || core_.WORLD_PRICE() != 1e12
                || core_.N() != 50 || core_.W() != 65 || core_.T() != 60 days
                || core_.RESISTANCE_HALF_LIFE() != 45 days
        ) revert InvalidBinding();

        // CREATE #3 always creates a new Profile after the new Token/Core pair is validated.
        WorldLandProfileBSCV2 profile_ = new WorldLandProfileBSCV2(core_);
        if (address(profile_.core()) != address(core_)) revert InvalidBinding();

        token = token_;
        core = core_;
        profile = profile_;
        emit WorldDeployed(address(token_), address(core_), address(profile_));
    }
}
