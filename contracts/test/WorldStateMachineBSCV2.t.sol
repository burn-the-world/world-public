// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {BSCV2TestBase} from "./BSCV2TestBase.sol";

/// @notice Deterministic new V2 scenarios. No historical test count is imported.
/// @dev Checks integer accounting on all 50 LAND after EVERY mixed step.
/// Resistance transition tests use the live read-only wall as pre-state; the separate
/// ResistanceDecay suite compares the real EVM arithmetic to independently certified values.
contract WorldStateMachineBSCV2Test is BSCV2TestBase {
    address[51] internal expectedOwner;
    uint256[51] internal expectedEpoch;
    address[51] internal profileAuthor;
    uint256[51] internal profileEpoch;
    uint256 internal minted;
    uint256 internal burned;
    uint256[16] internal counts;

    function _trackedBuy(address actor, uint256 q) internal {
        uint256 before_ = token.balanceOf(actor); uint256 supply = token.totalSupply();
        _buy(actor, q); minted += q;
        assertEq(token.balanceOf(actor), before_ + q); assertEq(token.totalSupply(), supply + q);
    }
    function _bootstrap() internal {
        for (uint256 a; a < actors.length; ++a) _trackedBuy(actors[a], 20 * Q);
        for (uint256 id = 1; id <= 50; ++id) {
            address actor = actors[(id - 1) % 4];
            assertTrue(_attack(actor, id, Q)); burned += Q;
            expectedOwner[id] = actor; expectedEpoch[id] = 1;
        }
        _assertAccounting();
    }
    function _assertModel() internal view {
        _assertAccounting(); assertEq(token.totalSupply(), minted - burned, "cumulative paid mints minus actual burns");
        for (uint256 id = 1; id <= 50; ++id) {
            (address owner,,, uint256 epoch,) = core.lands(id);
            assertEq(owner, expectedOwner[id], "modeled owner"); assertEq(epoch, expectedEpoch[id], "modeled epoch");
            (bool valid, address po, uint256 pe, string memory name, string memory logo, string memory website) = profile.getCurrentProfile(id);
            assertEq(po, owner); assertEq(pe, epoch);
            bool shouldBeValid = profileAuthor[id] == owner && profileEpoch[id] == epoch;
            assertEq(valid, shouldBeValid, "profile is controller+epoch scoped");
            if (!valid) { assertEq(bytes(name).length, 0); assertEq(bytes(logo).length, 0); assertEq(bytes(website).length, 0); }
        }
    }
    function _war(address actor, uint256 id, uint256 seed, bool defense) internal returns (bool ran) {
        uint256 balance = token.balanceOf(actor); if (balance == 0) return false;
        uint256 q = 1 + (seed >> 80) % (balance < 2 * Q ? balance : 2 * Q);
        uint256 wall = core.currentResistanceRaw(id); uint256 supply = token.totalSupply();
        if (defense) {
            _defend(actor, id, q); _land(id, expectedOwner[id], wall + q * S, expectedEpoch[id]);
        } else {
            bool taken = _attack(actor, id, q); bool expectedTake = q * S > wall;
            assertEq(taken, expectedTake, "strict raw comparison");
            if (expectedTake) {
                expectedOwner[id] = actor; expectedEpoch[id] += 1; ++counts[13];
                _land(id, actor, q * S - wall, expectedEpoch[id]);
            } else _land(id, expectedOwner[id], wall - q * S, expectedEpoch[id]);
        }
        (,, uint64 timestamp,,) = core.lands(id); assertEq(timestamp, block.timestamp);
        assertEq(token.totalSupply(), supply - q); assertEq(token.balanceOf(actor), balance - q); burned += q;
        return true;
    }
    function _nonwar(uint256 action, address actor, uint256 id, uint256 seed) internal returns (bool ran) {
        if (action == 0) {
            _trackedBuy(actor, 1 + (seed >> 96) % Q);
        } else if (action == 1 || action == 12) {
            uint256 before_ = token.balanceOf(actor); if (before_ == 0) return false;
            uint256 q = 1 + (seed >> 112) % before_;
            address to = action == 12 ? address(core) : actors[((seed >> 128) % 3 + 1 + (seed >> 8) % 4) % 4];
            uint256 recipientBefore = token.balanceOf(to); uint256 supply = token.totalSupply();
            _transfer(actor, to, q);
            if (actor != to) { assertEq(token.balanceOf(actor), before_ - q); assertEq(token.balanceOf(to), recipientBefore + q); }
            assertEq(token.totalSupply(), supply);
        } else if (action == 2) {
            uint256 before_ = token.balanceOf(actor); if (before_ == 0) return false;
            uint256 q = 1 + (seed >> 128) % before_; uint256 supply = token.totalSupply();
            uint256 claim = core.claimable(actor); uint256 income = core.accountedBNB();
            _burn(actor, q); burned += q;
            assertEq(token.balanceOf(actor), before_ - q); assertEq(token.totalSupply(), supply - q);
            assertEq(core.claimable(actor), claim); assertEq(core.accountedBNB(), income);
        } else if (action == 5) {
            if (actor == address(participant)) participant.settle(id); else { vm.prank(actor); core.settleLand(id); }
        } else if (action == 6) {
            uint256 available = core.claimable(actor) / WB; if (available == 0) return false;
            uint256 q = 1 + (seed >> 112) % available; uint256 claim = core.claimable(actor);
            _withdraw(actor, q); assertEq(core.claimable(actor), claim - q * WB);
        } else if (action == 7) {
            uint256 income = core.accountedBNB(); _donate(1 + (seed >> 112) % 100000);
            assertEq(core.accountedBNB(), income, "donation not released before sync");
            if (seed & 1 == 0) core.syncSurplus();
        } else if (action == 8) {
            address owner = expectedOwner[id]; _edit(owner, id);
            profileAuthor[id] = owner; profileEpoch[id] = expectedEpoch[id];
        } else if (action == 9) {
            vm.warp(block.timestamp + 1 + (seed >> 112) % (90 days));
        } else if (action == 10) {
            core.syncSurplus(); core.currentResistanceRaw(id); core.minimumAttackAtoms(id); core.checkpoint();
        } else if (action == 11) {
            _assertFail(actor, abi.encodeCall(core.attack, (id, expectedEpoch[id] - 1, 1)), 0);
            ++counts[15];
        }
        return true;
    }
    function _run(uint256 initialSeed) internal {
        _bootstrap(); uint256 seed = initialSeed;
        for (uint256 step; step < 1000; ++step) {
            seed = uint256(keccak256(abi.encode(seed, step)));
            uint256 action = seed % 13; address actor = actors[(seed >> 8) % 4]; uint256 id = 1 + (seed >> 32) % 50;
            bytes32 war = _warState(); bool ran;
            bool contractInvocation = action == 8 ? expectedOwner[id] == address(participant)
                : (action <= 6 || action == 12) && actor == address(participant);
            if (action == 3 || action == 4) ran = _war(actor, id, seed, action == 4);
            else { ran = _nonwar(action, actor, id, seed); assertEq(_warState(), war, "nonwar action refreshed war state"); }
            if (ran) { ++counts[action]; if (contractInvocation) ++counts[14]; }
            _assertModel();
        }
        for (uint256 i; i < 13; ++i) assertGt(counts[i], 0, "each mixed action executed");
        assertGt(counts[13], 0); assertGt(counts[14], 0); assertGt(counts[15], 0);
        emit log_named_uint("state machine seed", initialSeed);
        emit log_named_uint("mixed steps, each checked across all 50 LAND", 1000);
        emit log_named_uint("paid buys", counts[0]);
        emit log_named_uint("ordinary transfers", counts[1]);
        emit log_named_uint("holder burns", counts[2]);
        emit log_named_uint("attacks", counts[3]);
        emit log_named_uint("defenses", counts[4]);
        emit log_named_uint("land settlements", counts[5]);
        emit log_named_uint("withdrawals", counts[6]);
        emit log_named_uint("BNB donations", counts[7]);
        emit log_named_uint("profile edits", counts[8]);
        emit log_named_uint("time advances", counts[9]);
        emit log_named_uint("BNB syncs and views", counts[10]);
        emit log_named_uint("stale epoch checks", counts[11]);
        emit log_named_uint("mistaken WORLD transfers to Core", counts[12]);
        emit log_named_uint("successful takeovers", counts[13]);
        emit log_named_uint("contract actor mixed operations", counts[14]);
        emit log_named_uint("rejected stale-epoch transactions", counts[15]);
        emit log_named_uint("paid minted atoms", minted); emit log_named_uint("burned atoms", burned);
    }
    function test_StateMachineSeed20260928() public { _run(20260928); }
    function test_StateMachineSeed45() public { _run(45); }
    function test_StateMachineSeed65() public { _run(65); }
    function test_StateMachineSeedB5C2() public { _run(0xB5C2); }
}
