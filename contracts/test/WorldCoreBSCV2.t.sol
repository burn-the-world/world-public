// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {BSCV2TestBase, BSCV2Participant} from "./BSCV2TestBase.sol";
import {WorldCoreBSCV2} from "../src/WorldCoreBSCV2.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";

contract BSCV2RejectingRecipient { receive() external payable { revert("reject local BNB"); } }

contract WorldCoreBSCV2Test is BSCV2TestBase {
    using stdStorage for StdStorage;

    function test_Initial50LandParametersAndBinding() public view {
        assertEq(token.core(), address(core)); assertEq(address(core.token()), address(token));
        assertEq(address(profile.core()), address(core)); assertEq(token.totalSupply(), 0);
        assertEq(token.decimals(), 18); assertEq(core.N(), 50); assertEq(core.W(), 65);
        assertEq(core.T(), T); assertEq(core.RESISTANCE_HALF_LIFE(), H);
        assertEq(core.WORLD_PRICE(), 1e12); assertEq(core.TOKEN_UNIT(), Q);
        assertEq(core.RESISTANCE_LIMIT(), uint256(1) << 192); assertEq(core.MAX_WAR_ATOMS(), uint256(1) << 128);
        for (uint256 id = 1; id <= 50; ++id) assertEq(core.weightOf(id), id == 1 ? 6 : id <= 6 ? 3 : 1);
        _assertAccounting();
    }

    function test_BuyFullMintAndWideExactQuote() public {
        assertEq(core.quoteBuy(1), 1); assertEq(core.quoteBuy(Q), 1e12);
        assertEq(core.quoteBuy(Q + 1), 1e12 + 1);
        uint256 max = type(uint256).max;
        assertEq(core.quoteBuy(max), max / 1e6 + 1, "quote avoids intermediate overflow");
        _assertFail(alice, abi.encodeCall(core.buyWorld, (1, alice)), 0);
        _assertFail(alice, abi.encodeCall(core.buyWorld, (1, alice)), 2);
        _assertFail(alice, abi.encodeCall(core.buyWorld, (0, alice)), 0);
        _assertFail(alice, abi.encodeCall(core.buyWorld, (1, address(0))), 1);
        _buy(alice, 10000 * Q); assertEq(token.balanceOf(alice), 10000 * Q);
        assertEq(token.totalSupply(), 10000 * Q); assertEq(core.accountedBNB(), 0.01 ether);
        _assertAccounting();
    }

    function test_MistakenWorldTransferCannotBecomeInventoryOrIncome() public {
        _buy(alice, 7 * Q); _transfer(alice, address(core), 7 * Q);
        uint256 oldBNB = core.accountedBNB(); bytes32 war = _warState();
        core.syncSurplus(); assertEq(core.accountedBNB(), oldBNB); assertEq(_warState(), war);
        bytes32 state = _snapshot(); core.syncSurplus(); assertEq(_snapshot(), state);
        _buy(bob, 10 * Q);
        assertEq(token.totalSupply(), 17 * Q); assertEq(token.balanceOf(bob), 10 * Q);
        assertEq(token.balanceOf(address(core)), 7 * Q);
        assertTrue(_attack(bob, 1, Q));
        assertEq(token.balanceOf(address(core)), 7 * Q); assertEq(token.totalSupply(), 16 * Q);
        _assertAccounting();
    }

    function test_BuyToCoreAlsoMintsFullQuantityEveryTime() public {
        for (uint256 i; i < 2; ++i) {
            vm.prank(alice); core.buyWorld{value: 1e12}(Q, address(core)); core.syncSurplus();
        }
        assertEq(token.balanceOf(address(core)), 2 * Q); assertEq(token.totalSupply(), 2 * Q);
        assertEq(core.accountedBNB(), 2e12); _assertAccounting();
    }

    function test_DefendAfter45DaysCannotReviveOldWall() public {
        _buy(alice, 1000 * Q); _buy(carol, Q / 100);
        _attack(alice, 1, 1000 * Q); uint256 start = block.timestamp;
        vm.warp(start + H); assertEq(core.currentResistanceRaw(1), 500 * Q * S);
        _defend(carol, 1, Q / 100);
        _land(1, alice, (500 * Q + Q / 100) * S, 1);
        (,, uint64 time,,) = core.lands(1); assertEq(time, start + H);
        assertEq(token.totalSupply(), 0); assertEq(core.claimable(carol), 0);
        _assertAccounting();
    }

    function test_PastAttackReductionDecaysWithRemainingWall() public {
        _buy(alice, 2000 * Q); _buy(bob, 400 * Q);
        _attack(alice, 1, 1000 * Q); _attack(alice, 2, 1000 * Q);
        assertFalse(_attack(bob, 1, 400 * Q)); _land(1, alice, 600 * Q * S, 1);
        vm.warp(block.timestamp + H);
        assertEq(core.currentResistanceRaw(1), 300 * Q * S);
        assertEq(core.currentResistanceRaw(2), 500 * Q * S);
        _assertAccounting();
    }

    function test_EqualityZeroWallDoesNotTransferAndStrictExcessDoes() public {
        _buy(alice, 100 * Q); _buy(bob, 100 * Q + 1);
        _attack(alice, 1, 100 * Q);
        assertFalse(_attack(bob, 1, 99 * Q)); assertFalse(_attack(bob, 1, Q));
        _land(1, alice, 0, 1); assertEq(core.minimumAttackAtoms(1), 1);
        assertTrue(_attack(bob, 1, 1)); _land(1, bob, S, 2);
        assertEq(token.totalSupply(), 0); assertEq(token.balanceOf(address(core)), 0); _assertAccounting();
    }

    function test_FractionalExcessAndSubAtomThresholdPreserved() public {
        _buy(alice, 1); _buy(bob, 2); _attack(alice, 1, 1);
        vm.warp(block.timestamp + H); assertEq(core.currentResistanceRaw(1), S / 2);
        assertEq(core.minimumAttackAtoms(1), 1); assertTrue(_attack(bob, 1, 1));
        _land(1, bob, S / 2, 2); assertTrue(_attack(bob, 1, 1)); _land(1, bob, S / 2, 3);
        _assertAccounting();
    }

    function test_ExtremeIdleTailNeverChangesControllerWithoutAttack() public {
        _buy(alice, 1); _buy(bob, 1); _attack(alice, 1, 1); _edit(alice, 1);
        bytes32 anchor = _anchor(1); vm.warp(block.timestamp + 250 * H);
        assertEq(core.currentResistanceRaw(1), 1); assertEq(_anchor(1), anchor);
        (bool valid, address owner, uint256 epoch,,,) = profile.getCurrentProfile(1);
        assertTrue(valid); assertEq(owner, alice); assertEq(epoch, 1);
        core.settleLand(1); assertEq(_anchor(1), anchor);
        assertTrue(_attack(bob, 1, 1)); _land(1, bob, S - 1, 2); _assertAccounting();
    }

    function test_ViewsSettlementWithdrawalSyncProfileDoNotRefreshWarAnchor() public {
        _buy(alice, 1000 * Q); _attack(alice, 1, 1000 * Q);
        bytes32 anchor = _anchor(1); uint64 incomeTime = core.t0();
        vm.warp(block.timestamp + H);
        for (uint256 i; i < 16; ++i) {
            core.currentResistanceRaw(1); core.minimumAttackAtoms(1); core.checkpoint();
            core.settleLand(1); core.syncSurplus(); _edit(alice, 1);
            if (core.claimable(alice) >= WB) _withdraw(alice, 1);
            assertEq(_anchor(1), anchor); assertEq(core.t0(), incomeTime);
        }
        _donate(99); core.syncSurplus(); assertEq(_anchor(1), anchor);
        assertEq(core.currentResistanceRaw(1), 500 * Q * S); _assertAccounting();
    }

    function test_SameSecondSplitAttacksAndDefenseEqualWholeAmount() public {
        _buy(alice, 2000 * Q); _buy(bob, 123 * Q * 2); _buy(carol, 99 * Q * 2);
        _attack(alice, 1, 1000 * Q); _attack(alice, 2, 1000 * Q);
        vm.warp(block.timestamp + H + 12345);
        assertFalse(_attack(bob, 1, 123 * Q));
        for (uint256 i; i < 3; ++i) assertFalse(_attack(bob, 2, 41 * Q));
        _defend(carol, 1, 99 * Q);
        for (uint256 i; i < 9; ++i) _defend(carol, 2, 11 * Q);
        (, uint256 r1, uint64 t1,,) = core.lands(1);
        (, uint256 r2, uint64 t2,,) = core.lands(2);
        assertEq(r1, r2); assertEq(t1, t2); _assertAccounting();
    }

    function test_ThirdPartyDefenseDoesNotGainRevenueOrInvalidateProfile() public {
        _buy(alice, 10 * Q); _buy(carol, Q); _attack(alice, 1, 10 * Q); _edit(alice, 1);
        vm.warp(block.timestamp + H); _defend(carol, 1, Q); _land(1, alice, 6 * Q * S, 1);
        (bool valid,,,,,) = profile.getCurrentProfile(1); assertTrue(valid);
        core.settleLand(1); assertGt(core.claimable(alice), 0); assertEq(core.claimable(carol), 0);
        _assertFail(carol, abi.encodeCall(core.withdrawRewards, (payable(carol), 1)), 0); _assertAccounting();
    }

    function test_ThousandRealOneAtomDefensesConsumeTokensAndCannotReviveOldWall() public {
        _buy(alice, 2000 * Q); _buy(bob, 1000);
        _attack(alice, 1, 1000 * Q); _attack(alice, 2, 1000 * Q);
        _approve(bob, 1000); bytes32 controlAnchor = _anchor(2);
        uint256 start = block.timestamp; uint256 previous = 1000 * Q * S;
        for (uint256 i = 1; i <= 1000; ++i) {
            vm.warp(start + i * 1 hours); _defend(bob, 1, 1);
            uint256 actual = core.currentResistanceRaw(1);
            // Every support is a real burn; 1 atom cannot restore this decayed old wall.
            assertLt(actual, previous); previous = actual;
            assertEq(token.balanceOf(bob), 1000 - i); assertEq(token.allowance(bob, address(core)), 1000 - i);
            assertEq(token.totalSupply(), 1000 - i);
        }
        uint256 untouched = core.currentResistanceRaw(2);
        // Each real support adds at most S raw at the final time. The certified
        // cumulative checkpoint error is strictly below 1000 * 46 raw ticks.
        assertLt(previous, untouched + 1000 * S + 1000 * 46);
        assertEq(_anchor(2), controlAnchor); assertEq(token.balanceOf(address(core)), 0); _assertAccounting();
    }

    function test_SameEpochQuoteDoesNotLockDefenseAndStaleEpochRejects() public {
        _buy(alice, 10); _buy(bob, 3); _buy(carol, 2); _attack(alice, 1, 2);
        uint256 quoted = core.minimumAttackAtoms(1); assertEq(quoted, 3);
        _defend(carol, 1, 2); assertFalse(_attack(bob, 1, quoted)); _land(1, alice, S, 1);
        assertTrue(_attack(alice, 1, 2)); _assertFail(bob, abi.encodeCall(core.attack, (1, 1, 1)), 0);
        _assertAccounting();
    }

    function test_NeutralTreasureOldControllerClaimSelfWarAndRecapture() public {
        _buy(alice, 20); _buy(bob, 20); _donate(1300 - 2); core.syncSurplus();
        vm.warp(block.timestamp + T); (, uint256 j1) = core.checkpoint();
        core.settleLand(1); (,,,, uint256 landJ) = core.lands(1); assertEq(landJ, 0);
        assertTrue(_attack(alice, 1, 1)); assertEq(core.claimable(alice), 6 * j1); _edit(alice, 1);
        vm.warp(block.timestamp + T); (, uint256 j2) = core.checkpoint();
        assertTrue(_attack(alice, 1, 2)); assertEq(core.claimable(alice), 6 * j2);
        (bool valid,,,,,) = profile.getCurrentProfile(1); assertFalse(valid);
        assertTrue(_attack(bob, 1, 3)); assertEq(core.claimable(alice), 6 * j2);
        _withdraw(alice, core.claimable(alice) / WB); assertLt(core.claimable(alice), WB);
        assertTrue(_attack(alice, 1, 4)); (valid,,,,,) = profile.getCurrentProfile(1); assertFalse(valid);
        _assertAccounting();
    }

    function test_OnlyCurrentInputBurnedAndAllSupplyZeroCanBuyAgain() public {
        _buy(alice, 10); _attack(alice, 1, 10); assertEq(token.totalSupply(), 0);
        _buy(bob, 21); _defend(bob, 1, 5); assertEq(token.totalSupply(), 16);
        assertTrue(_attack(bob, 1, 16)); assertEq(token.totalSupply(), 0); _land(1, bob, S, 2);
        _buy(alice, 2); assertTrue(_attack(alice, 1, 2)); assertEq(token.totalSupply(), 0);
        _land(1, alice, S, 3); _assertAccounting();
    }

    function test_RealContractParticipantFullLifecycleAndLateFailureRollback() public {
        address p = address(participant); _buy(p, 100 * Q); _approve(p, 100 * Q);
        assertTrue(_attack(p, 1, 10 * Q)); _edit(p, 1);
        vm.warp(block.timestamp + H); _defend(p, 1, Q); assertFalse(_attack(p, 1, Q));
        participant.settle(1); uint256 available = core.claimable(p) / WB; assertGt(available, 0);
        uint256 beforeBNB = p.balance; _withdraw(p, available); assertEq(p.balance, beforeBNB + available);
        (bool valid, address owner,,,,) = profile.getCurrentProfile(1); assertTrue(valid); assertEq(owner, p);
        bytes32 state = _snapshot(); vm.expectRevert(bytes("later local transaction step failed"));
        participant.attackThenFail(1, 1, 6 * Q); assertEq(_snapshot(), state, "nested successful burn is rolled back");
        assertTrue(_attack(p, 1, 6 * Q)); (valid,,,,,) = profile.getCurrentProfile(1); assertFalse(valid);
        _assertAccounting();
    }

    function test_InvalidActionsFullyRollbackBalancesAllowancesAndClaims() public {
        _buy(alice, 10); _buy(bob, 10); _attack(alice, 1, 5);
        _assertFail(bob, abi.encodeCall(core.attack, (1, 0, 1)), 0);
        _assertFail(bob, abi.encodeCall(core.attack, (1, 1, 0)), 0);
        _assertFail(bob, abi.encodeCall(core.attack, (0, 0, 1)), 0);
        _assertFail(bob, abi.encodeCall(core.attack, (51, 0, 1)), 0);
        _assertFail(bob, abi.encodeCall(core.attack, (1, 1, 11)), 0);
        _assertFail(bob, abi.encodeCall(core.attack, (1, 1, uint256(1) << 128)), 0);
        _assertFail(bob, abi.encodeCall(core.attack, (1, 1, type(uint256).max)), 0);
        _approve(bob, 0); _assertFail(bob, abi.encodeCall(core.attack, (1, 1, 1)), 0);
        _assertFail(bob, abi.encodeCall(core.defend, (1, 1, 1)), 0);
        _assertFail(alice, abi.encodeCall(core.defend, (2, 0, 1)), 0);
        _assertFail(alice, abi.encodeCall(core.defend, (1, 0, 1)), 0);
        _assertFail(alice, abi.encodeCall(core.defend, (1, 1, 0)), 0);
        _assertFail(alice, abi.encodeCall(core.defend, (1, 1, uint256(1) << 128)), 0);
        _assertFail(alice, abi.encodeCall(core.settleLand, (0)), 0);
        _assertFail(alice, abi.encodeCall(core.withdrawRewards, (payable(address(0)), 1)), 0);
        _assertFail(alice, abi.encodeCall(core.withdrawRewards, (payable(alice), 0)), 0);
        _assertFail(alice, abi.encodeCall(core.withdrawRewards, (payable(alice), 1)), 0); _assertAccounting();
    }

    function test_ResistanceCapacityLargestInputAdditionAndDecay() public {
        uint256 amount = (uint256(1) << 128) - 1;
        vm.deal(alice, core.quoteBuy(amount)); _buy(alice, amount); _buy(bob, 2);
        _attack(alice, 1, amount); _land(1, alice, amount * S, 1);
        assertEq(core.minimumAttackAtoms(1), uint256(1) << 128, "quote explicitly exceeds single-war domain at top wall");
        _assertFail(bob, abi.encodeCall(core.defend, (1, 1, 1)), 0);
        vm.warp(block.timestamp + H); assertEq(core.currentResistanceRaw(1), amount * S / 2);
        _defend(bob, 1, 1); _land(1, alice, amount * S / 2 + S, 1); _assertAccounting();
    }

    function test_FaultFixtureEpochOverflowRejectsWithoutBurn() public {
        _buy(alice, 10); _buy(bob, 10); _attack(alice, 1, 1);
        stdstore.target(address(core)).sig("lands(uint256)").with_key(1).depth(3).checked_write(type(uint256).max);
        _assertFail(bob, abi.encodeCall(core.attack, (1, type(uint256).max, 2)), 0);
    }

    function test_TimeBackwardsAndAboveUint64RejectedWithoutChanges() public {
        _buy(alice, 10); _attack(alice, 1, 1); uint256 t = block.timestamp;
        vm.warp(t - 1); _assertFail(alice, abi.encodeCall(core.attack, (1, 1, 2)), 0);
        _assertFail(alice, abi.encodeCall(core.defend, (1, 1, 1)), 0);
        vm.expectRevert(WorldCoreBSCV2.InvalidTime.selector); core.currentResistanceRaw(1);
        vm.warp(uint256(type(uint64).max) + 1);
        _assertFail(alice, abi.encodeCall(core.attack, (1, 1, 2)), 0);
        vm.expectRevert(WorldCoreBSCV2.InvalidTime.selector); core.checkpoint();
        vm.warp(t); _assertAccounting();
    }

    function test_FaultFixtureSupplyCapacityRejectsFullMintAtomically() public {
        _buy(alice, 10);
        // Artificial uint256 supply fixture, not a reachable paid Treasury state.
        stdstore.target(address(token)).sig("totalSupply()").checked_write(type(uint256).max);
        _assertFail(alice, abi.encodeCall(core.buyWorld, (1, alice)), 1);
    }

    function test_FailedBNBRecipientRollsBackClaimAndLandStillTransferable() public {
        BSCV2RejectingRecipient rejecting = new BSCV2RejectingRecipient();
        _buy(alice, 10 * Q); _buy(bob, 2); _attack(alice, 1, 1);
        vm.warp(block.timestamp + T); core.settleLand(1);
        _assertFail(alice, abi.encodeCall(core.withdrawRewards, (payable(address(rejecting)), 1)), 0);
        uint256 debt = core.claimable(alice); assertTrue(_attack(bob, 1, 2)); assertEq(core.claimable(alice), debt);
        _withdraw(alice, 1); _assertAccounting();
    }

    function test_FaultFixtureBNBDeficitAndIncomeCapacityRejectAtomically() public {
        _donate(10); core.syncSurplus(); vm.deal(address(core), 9);
        _assertFail(alice, abi.encodeCall(core.syncSurplus, ()), 0);
        _assertFail(alice, abi.encodeCall(core.buyWorld, (Q, alice)), 1e12);
        vm.deal(address(core), type(uint128).max);
        core.syncSurplus(); vm.deal(alice, 100);
        _assertFail(alice, abi.encodeCall(core.buyWorld, (1, alice)), 1);
    }

    function test_BNBDonationOnlyOnceAndOnlyAfterRecognition() public {
        _donate(1300); vm.warp(block.timestamp + T);
        (uint256 u, uint256 j) = core.checkpoint(); assertEq(u, 0); assertEq(j, 0);
        core.syncSurplus(); assertEq(core.U0(), 1300 * B); assertEq(core.J0(), 0);
        bytes32 state = _snapshot(); core.syncSurplus(); assertEq(_snapshot(), state);
        vm.warp(block.timestamp + T); (u, j) = core.checkpoint(); assertEq(u, 650 * B); assertEq(j, 650 * B);
        _donate(3); _buy(alice, 1); assertEq(core.accountedBNB(), 1304);
        assertEq(core.U0(), 654 * B); assertEq(core.J0(), 650 * B); _assertAccounting();
    }

    function test_WithdrawalToCoreBecomesNewBNBDonationExactlyOnce() public {
        _buy(alice, Q); _attack(alice, 1, 1); vm.warp(block.timestamp + T); core.settleLand(1);
        uint256 oldBalance = address(core).balance; uint256 oldAccounted = core.accountedBNB();
        (uint256 u, uint256 j) = core.checkpoint(); bytes32 anchor = _anchor(1);
        vm.prank(alice); core.withdrawRewards(payable(address(core)), 1);
        assertEq(address(core).balance, oldBalance); assertEq(core.accountedBNB(), oldAccounted - 1);
        core.syncSurplus(); assertEq(core.accountedBNB(), oldAccounted);
        assertEq(core.U0(), u + B); assertEq(core.J0(), j); assertEq(_anchor(1), anchor);
        bytes32 state = _snapshot(); core.syncSurplus(); assertEq(_snapshot(), state); _assertAccounting();
    }

    function test_NaturalFractionalClaimRemainderPreservedAfterWithdrawal() public {
        _buy(alice, 1); _donate(1000); core.syncSurplus(); _attack(alice, 1, 1);
        vm.warp(block.timestamp + T + 127); core.settleLand(1);
        uint256 numerator = core.claimable(alice); uint256 whole = numerator / WB;
        assertGt(numerator % WB, 0); _withdraw(alice, whole); assertEq(core.claimable(alice), numerator % WB);
        _assertFail(alice, abi.encodeCall(core.withdrawRewards, (payable(alice), 1)), 0); _assertAccounting();
    }

    function test_FrequentAndSingleSettlementWithdrawalHaveIdenticalDebt() public {
        _buy(alice, 50); _donate(1_300_000 - 1); core.syncSurplus();
        for (uint256 id = 1; id <= 50; ++id) _attack(alice, id, 1);
        uint256 snap = vm.snapshotState(); uint256 start = block.timestamp; uint256 paid;
        for (uint256 day = 1; day <= 60; ++day) {
            vm.warp(start + day * 1 days);
            for (uint256 id = 1; id <= 50; ++id) core.settleLand(id);
            uint256 q = core.claimable(alice) / WB; if (q != 0) { _withdraw(alice, q); paid += q; }
        }
        uint256 remainder = core.claimable(alice); uint256 finalU = core.U0(); uint64 finalT = core.t0();
        assertTrue(vm.revertToState(snap)); vm.warp(start + T);
        for (uint256 id = 1; id <= 50; ++id) core.settleLand(id);
        uint256 single = core.claimable(alice) / WB; _withdraw(alice, single);
        assertEq(single, paid); assertEq(core.claimable(alice), remainder);
        assertEq(core.U0(), finalU); assertEq(core.t0(), finalT); _assertAccounting();
    }
}
