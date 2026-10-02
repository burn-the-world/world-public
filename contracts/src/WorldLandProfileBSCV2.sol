// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {WorldCoreBSCV2} from "./WorldCoreBSCV2.sol";
import {WorldTokenBSCV2} from "./WorldTokenBSCV2.sol";

/// @notice Optional, fee-free display metadata for the current LAND controller and epoch.
/// @dev Core never calls this contract. Metadata confers no protocol rights or endorsement.
contract WorldLandProfileBSCV2 {
    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_LOGO_URI_BYTES = 256;
    uint256 public constant MAX_WEBSITE_BYTES = 256;

    WorldCoreBSCV2 public immutable core;

    struct Profile {
        address controller;
        uint256 epoch;
        string name;
        string logoURI;
        string website;
    }

    // Only the last submission is retained. Historical edits remain in events.
    mapping(uint256 => Profile) private profiles;

    error InvalidCore();
    error InvalidLand();
    error NeutralLand();
    error NotController(address caller, address controller);
    error StaleEpoch(uint256 expected, uint256 current);
    error NameTooLong();
    error LogoURITooLong();
    error WebsiteTooLong();

    event ProfileUpdated(
        uint256 indexed landId,
        uint256 indexed epoch,
        address indexed controller,
        string name,
        string logoURI,
        string website
    );

    constructor(WorldCoreBSCV2 core_) {
        if (address(core_).code.length == 0) revert InvalidCore();
        if (
            core_.N() != 50 || core_.W() != 65 || core_.T() != 60 days
                || core_.RESISTANCE_HALF_LIFE() != 45 days || core_.WORLD_PRICE() != 1e12
                || core_.TOKEN_UNIT() != 1e18
        ) revert InvalidCore();
        WorldTokenBSCV2 token_ = core_.token();
        if (address(token_).code.length == 0 || token_.core() != address(core_) || token_.decimals() != 18) revert InvalidCore();
        core = core_;
    }

    /// @notice Replace all three fields; empty strings clear their displayed content.
    /// @dev No BNB, WORLD, allowance or protocol service fee is required. Network gas still applies.
    function setProfile(
        uint256 landId,
        uint256 expectedEpoch,
        string calldata name,
        string calldata logoURI,
        string calldata website
    ) external {
        _validLand(landId);
        // V2 getter: (controller, resistanceRaw, uint64 lastResistanceUpdate, epoch, j).
        (address controller,,, uint256 epoch,) = core.lands(landId);
        if (controller == address(0)) revert NeutralLand();
        if (msg.sender != controller) revert NotController(msg.sender, controller);
        if (expectedEpoch != epoch) revert StaleEpoch(expectedEpoch, epoch);
        if (bytes(name).length > MAX_NAME_BYTES) revert NameTooLong();
        if (bytes(logoURI).length > MAX_LOGO_URI_BYTES) revert LogoURITooLong();
        if (bytes(website).length > MAX_WEBSITE_BYTES) revert WebsiteTooLong();

        profiles[landId] = Profile(controller, epoch, name, logoURI, website);
        emit ProfileUpdated(landId, epoch, controller, name, logoURI, website);
    }

    /// @notice Return metadata only when its author and epoch still match the current Core state.
    /// @dev `valid` means this epoch has a submission, including an intentional all-empty submission.
    ///      On mismatch, current Core controller/epoch are returned with false and three empty strings.
    function getCurrentProfile(uint256 landId)
        external
        view
        returns (bool valid, address controller, uint256 epoch, string memory name, string memory logoURI, string memory website)
    {
        _validLand(landId);
        (controller,,, epoch,) = core.lands(landId);
        Profile storage profile = profiles[landId];
        if (controller != address(0) && profile.controller == controller && profile.epoch == epoch) {
            return (true, controller, epoch, profile.name, profile.logoURI, profile.website);
        }
        return (false, controller, epoch, "", "", "");
    }

    function _validLand(uint256 landId) private view {
        if (landId == 0 || landId > core.N()) revert InvalidLand();
    }
}
