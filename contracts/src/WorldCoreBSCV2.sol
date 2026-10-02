// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {WorldTokenBSCV2} from "./WorldTokenBSCV2.sol";
import {TreasuryDecayBSC} from "./libraries/TreasuryDecayBSC.sol";
import {ResistanceDecayBSC} from "./libraries/ResistanceDecayBSC.sol";

/// @notice Independent BSC V2 world. WORLD amounts are atoms; Resistance is Q64 atoms.
/// @dev Treasury retains the BSC 60-day algorithm. Only real wars checkpoint Resistance.
contract WorldCoreBSCV2 is ReentrancyGuard {
    uint256 public constant N = 50;
    uint256 public constant W = 65;
    uint256 public constant T = 60 days;
    uint256 public constant B = 1 << 96;
    uint256 public constant WORLD_PRICE = 1e12;
    uint256 public constant TOKEN_UNIT = 1e18;
    uint256 public constant RESISTANCE_HALF_LIFE = 45 days;
    uint256 public constant RESISTANCE_LIMIT = 1 << 192;
    uint256 public constant MAX_WAR_ATOMS = 1 << 128;

    WorldTokenBSCV2 public immutable token;
    uint256 public U0;
    uint256 public J0;
    uint64 public t0;
    uint256 public accountedBNB;

    struct Land {
        address controller;
        uint256 resistanceRaw;
        uint64 lastResistanceUpdate;
        uint256 epoch;
        uint256 j;
    }

    mapping(uint256 => Land) public lands;
    mapping(address => uint256) public claimable;

    error InvalidToken();
    error InvalidLand();
    error InvalidAmount();
    error InvalidRecipient();
    error StaleEpoch();
    error NeutralLand();
    error InvalidTime();
    error ResistanceRange();
    error EpochOverflow();
    error TreasuryRange();
    error BNBDeficit();
    error IncorrectPayment();
    error SupplyOverflow();
    error InsufficientClaim();
    error BNBTransferFailed();

    event Bought(address indexed payer, address indexed recipient, uint256 q, uint256 cost);
    event Earned(uint256 indexed id, address indexed beneficiary, uint256 delta, uint256 J);
    event AttackProgress(
        uint256 indexed id, uint256 epoch, address indexed attacker, uint256 amount,
        uint256 resistanceRaw, uint64 lastResistanceUpdate
    );
    event Taken(
        uint256 indexed id, uint256 epoch, address indexed oldController, address indexed newController,
        uint256 amount, uint256 wallRaw, uint256 resistanceRaw, uint64 lastResistanceUpdate
    );
    event Defended(
        uint256 indexed id, uint256 epoch, address indexed supporter, uint256 amount,
        uint256 resistanceRaw, uint64 lastResistanceUpdate
    );
    event Withdrawn(address indexed beneficiary, address indexed to, uint256 amountWei);

    constructor(WorldTokenBSCV2 token_) {
        if (address(token_).code.length == 0 || token_.core() != address(this)) revert InvalidToken();
        token = token_;
        t0 = _time();
    }

    /// @dev Donations become income only when buyWorld or syncSurplus recognizes them.
    receive() external payable {}

    function weightOf(uint256 id) public pure returns (uint256) {
        _validLand(id);
        return id == 1 ? 6 : (id <= 6 ? 3 : 1);
    }

    function quoteBuy(uint256 q) public pure returns (uint256) {
        if (q == 0) revert InvalidAmount();
        return Math.mulDiv(q, WORLD_PRICE, TOKEN_UNIT, Math.Rounding.Ceil);
    }

    /// @notice Current unreleased BNB and cumulative release, both scaled by B.
    function checkpoint() public view returns (uint256 U, uint256 J) {
        return _checkpointAt(_time());
    }

    /// @notice Current deterministic Q64 wall; does not write its value or time anchor.
    function currentResistanceRaw(uint256 id) public view returns (uint256) {
        _validLand(id);
        return _wallAt(lands[id], _time());
    }

    /// @notice Smallest integer atom amount strictly above the current wall.
    /// @dev A quote of MAX_WAR_ATOMS is outside the single-war input domain.
    ///      expectedEpoch does not lock same-epoch defense or the passage of time.
    function minimumAttackAtoms(uint256 id) external view returns (uint256) {
        return (currentResistanceRaw(id) >> 64) + 1;
    }

    function buyWorld(uint256 q, address recipient) external payable nonReentrant {
        if (recipient == address(0)) revert InvalidRecipient();
        uint256 cost = quoteBuy(q);
        if (msg.value != cost) revert IncorrectPayment();
        uint256 extraBNB = _takeSurplus(msg.value);
        if (q > type(uint256).max - token.totalSupply()) revert SupplyOverflow();
        _addIncome(cost + extraBNB);
        token.mint(recipient, q);
        emit Bought(msg.sender, recipient, q, cost);
    }

    function syncSurplus() external nonReentrant {
        _addIncome(_takeSurplus(0));
    }

    function settleLand(uint256 id) external nonReentrant {
        _validLand(id);
        address beneficiary = lands[id].controller;
        if (beneficiary == address(0)) return;
        (, uint256 J) = checkpoint();
        _creditLand(id, beneficiary, J);
    }

    function attack(uint256 id, uint256 expectedEpoch, uint256 amount)
        external nonReentrant returns (bool taken)
    {
        _validLand(id);
        uint256 spendRaw = _warRaw(amount);
        Land storage land = lands[id];
        if (land.epoch != expectedEpoch) revert StaleEpoch();
        uint64 now_ = _time();
        uint256 wallRaw = _wallAt(land, now_);
        taken = spendRaw > wallRaw;
        if (taken && land.epoch == type(uint256).max) revert EpochOverflow();

        // Only this call's atoms burn; old walls and takeover excess are not tokens.
        // Any later failure rolls back allowance, balances, supply and emitted logs.
        token.burnFrom(msg.sender, amount);
        if (!taken) {
            land.resistanceRaw = wallRaw - spendRaw;
            land.lastResistanceUpdate = now_;
            emit AttackProgress(id, land.epoch, msg.sender, amount, land.resistanceRaw, now_);
            return false;
        }

        address oldOwner = land.controller;
        (, uint256 J) = _checkpointAt(now_);
        _creditLand(id, oldOwner == address(0) ? msg.sender : oldOwner, J);
        // 0 < spendRaw-wallRaw <= spendRaw < RESISTANCE_LIMIT.
        land.resistanceRaw = spendRaw - wallRaw;
        land.lastResistanceUpdate = now_;
        land.controller = msg.sender;
        land.epoch += 1;
        emit Taken(id, land.epoch, oldOwner, msg.sender, amount, wallRaw, land.resistanceRaw, now_);
    }

    function defend(uint256 id, uint256 expectedEpoch, uint256 amount) external nonReentrant {
        _validLand(id);
        uint256 spendRaw = _warRaw(amount);
        Land storage land = lands[id];
        if (land.controller == address(0)) revert NeutralLand();
        if (land.epoch != expectedEpoch) revert StaleEpoch();
        uint64 now_ = _time();
        uint256 wallRaw = _wallAt(land, now_);
        if (spendRaw >= RESISTANCE_LIMIT - wallRaw) revert ResistanceRange();
        token.burnFrom(msg.sender, amount);
        land.resistanceRaw = wallRaw + spendRaw;
        land.lastResistanceUpdate = now_;
        emit Defended(id, land.epoch, msg.sender, amount, land.resistanceRaw, now_);
    }

    function withdrawRewards(address payable to, uint256 amountWei) external nonReentrant {
        if (to == address(0)) revert InvalidRecipient();
        if (amountWei == 0) revert InvalidAmount();
        uint256 debit = amountWei * W * B;
        if (claimable[msg.sender] < debit) revert InsufficientClaim();
        claimable[msg.sender] -= debit;
        accountedBNB -= amountWei;
        (bool success,) = to.call{value: amountWei}("");
        if (!success) revert BNBTransferFailed();
        emit Withdrawn(msg.sender, to, amountWei);
    }

    function _checkpointAt(uint64 now_) private view returns (uint256 U, uint256 J) {
        if (now_ < t0) revert InvalidTime();
        U = TreasuryDecayBSC.remainingUpper(U0, now_ - t0);
        J = J0 + (U0 - U);
    }

    function _wallAt(Land storage land, uint64 now_) private view returns (uint256) {
        if (now_ < land.lastResistanceUpdate) revert InvalidTime();
        return ResistanceDecayBSC.remainingUpper(land.resistanceRaw, now_ - land.lastResistanceUpdate);
    }

    function _warRaw(uint256 amount) private pure returns (uint256) {
        if (amount == 0) revert InvalidAmount();
        if (amount >= MAX_WAR_ATOMS) revert ResistanceRange();
        return amount << 64;
    }

    function _addIncome(uint256 weiAmount) private {
        if (weiAmount == 0) return;
        (uint256 U, uint256 J) = checkpoint();
        if (weiAmount > type(uint128).max - accountedBNB) revert TreasuryRange();
        uint256 nextU = U + weiAmount * B;
        if (nextU >= (uint256(1) << 224)) revert TreasuryRange();
        U0 = nextU;
        J0 = J;
        t0 = _time();
        accountedBNB += weiAmount;
    }

    /// @dev WORLD held by Core is deliberately irrelevant and has no recovery entry point.
    function _takeSurplus(uint256 excludedWei) private view returns (uint256 extraBNB) {
        if (address(this).balance < excludedWei) revert BNBDeficit();
        uint256 oldBNB = address(this).balance - excludedWei;
        if (oldBNB < accountedBNB) revert BNBDeficit();
        return oldBNB - accountedBNB;
    }

    function _creditLand(uint256 id, address beneficiary, uint256 J) private {
        Land storage land = lands[id];
        uint256 delta = weightOf(id) * (J - land.j);
        claimable[beneficiary] += delta;
        land.j = J;
        emit Earned(id, beneficiary, delta, J);
    }

    function _validLand(uint256 id) private pure {
        if (id == 0 || id > N) revert InvalidLand();
    }

    function _time() private view returns (uint64) {
        if (block.timestamp > type(uint64).max) revert InvalidTime();
        return uint64(block.timestamp);
    }
}
