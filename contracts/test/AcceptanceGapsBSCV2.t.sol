// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {BSCV2TestBase} from "./BSCV2TestBase.sol";
import {WorldCoreBSCV2} from "../src/WorldCoreBSCV2.sol";

/// @dev Local rejection regression: every Core write entry shares the withdrawal lock.
contract WithdrawalLockProbeBSCV2 {
    WorldCoreBSCV2 private immutable core;
    uint256 public attempts;
    uint256 public successes;
    uint256 public wrongErrors;

    constructor(WorldCoreBSCV2 core_) { core = core_; }

    receive() external payable {
        bytes[6] memory calls = [
            abi.encodeCall(core.syncSurplus, ()),
            abi.encodeCall(core.settleLand, (1)),
            abi.encodeCall(core.attack, (1, 1, 1)),
            abi.encodeCall(core.defend, (1, 1, 1)),
            abi.encodeCall(core.withdrawRewards, (payable(address(this)), 1)),
            abi.encodeCall(core.buyWorld, (1, address(this)))
        ];
        for (uint256 i; i < calls.length; ++i) {
            ++attempts;
            (bool ok, bytes memory reason) = address(core).call{value: i == 5 ? 1 : 0}(calls[i]);
            if (ok) ++successes;
            else if (keccak256(reason) != keccak256(abi.encodeWithSignature("ReentrancyGuardReentrantCall()"))) ++wrongErrors;
        }
    }
}

/// @notice Additional applicable old BSC regressions adapted to real V2 contracts.
/// @dev Numerical corruption cases explicitly use local fault fixtures; successful
/// paid issuance cases use genuine calls and only vm.deal to fund the local payer.
contract AcceptanceGapsBSCV2Test is BSCV2TestBase {
    using stdStorage for StdStorage;

    function test_ActualLargestFreshPaidPurchaseTreasuryCapAndNextAtomRollback() public {
        uint256 maxBNB = type(uint128).max;
        uint256 maxFreshPurchase = maxBNB * 1e6;
        vm.deal(alice, maxBNB + 1);
        assertEq(core.quoteBuy(maxFreshPurchase), maxBNB);
        _buy(alice, maxFreshPurchase);
        assertEq(token.totalSupply(), maxFreshPurchase);
        assertEq(token.balanceOf(alice), maxFreshPurchase);
        assertEq(core.accountedBNB(), maxBNB);
        assertEq(core.U0(), maxBNB * B);
        assertEq(address(core).balance, maxBNB);
        assertGt(maxFreshPurchase, uint256(1) << 128, "Token purchase domain is wider than war domain");
        _assertFail(alice, abi.encodeCall(core.buyWorld, (1, alice)), 1);
        _assertAccounting();
    }

    function test_ActualFreshPurchaseAboveTreasuryCapRevertsBeforeAnyMint() public {
        uint256 q = uint256(type(uint128).max) * 1e6 + 1;
        uint256 cost = uint256(type(uint128).max) + 1;
        assertEq(core.quoteBuy(q), cost);
        vm.deal(alice, cost);
        _assertFail(alice, abi.encodeCall(core.buyWorld, (q, alice)), cost);
        assertEq(token.totalSupply(), 0);
        assertEq(core.accountedBNB(), 0);
        assertEq(address(core).balance, 0);
        _assertAccounting();
    }

    function test_FaultFixtureCheckpointFailureAfterBurnRestoresActualTokenWrites() public {
        _buy(alice, 1);
        _buy(bob, 2);
        _attack(alice, 1, 1);
        _approve(bob, 2);
        vm.warp(block.timestamp + T);
        // Explicitly impossible ordinary accounting: force the later checkpoint
        // addition to overflow after the actual Core-authorized Token burn.
        stdstore.target(address(core)).sig(core.J0.selector).checked_write(type(uint256).max);
        bytes32 balanceSlot = bytes32(stdstore.target(address(token)).sig("balanceOf(address)").with_key(bob).find());
        bytes32 supplySlot = bytes32(stdstore.target(address(token)).sig("totalSupply()").find());
        bytes32 allowanceSlot = bytes32(
            stdstore.target(address(token)).sig("allowance(address,address)").with_key(bob).with_key(address(core)).find()
        );
        bytes32 before_ = _snapshot();
        vm.startStateDiffRecording();
        vm.prank(bob);
        (bool ok, bytes memory reason) = address(core).call(abi.encodeCall(core.attack, (1, 1, 2)));
        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        assertFalse(ok);
        assertEq(reason, abi.encodeWithSignature("Panic(uint256)", 0x11));
        uint256 observed;
        for (uint256 i; i < accesses.length; ++i) {
            for (uint256 k; k < accesses[i].storageAccesses.length; ++k) {
                Vm.StorageAccess memory a = accesses[i].storageAccesses[k];
                if (a.account != address(token) || !a.isWrite || uint256(a.previousValue) != 2 || uint256(a.newValue) != 0) continue;
                if (a.slot == balanceSlot) observed |= 1;
                else if (a.slot == supplySlot) observed |= 2;
                else if (a.slot == allowanceSlot) observed |= 4;
                else continue;
                assertTrue(a.reverted, "each real Token write must be rolled back");
            }
        }
        assertEq(observed, 7, "observed burn of balance, supply and finite approval before later failure");
        assertEq(_snapshot(), before_);
        assertEq(token.totalSupply(), 2);
        assertEq(token.balanceOf(bob), 2);
        assertEq(token.allowance(bob, address(core)), 2);
    }

    function test_FaultFixtureClaimOverflowRejectsSettlementAndPostBurnTakeoverAtomically() public {
        _buy(alice, 1);
        _buy(bob, 2);
        _attack(alice, 1, 1);
        _approve(bob, 2);
        vm.warp(block.timestamp + T);
        // Local arithmetic fault fixture, not a reachable legitimate Claim.
        stdstore.target(address(core)).sig("claimable(address)").with_key(alice).checked_write(type(uint256).max);
        _assertFail(bob, abi.encodeCall(core.settleLand, (1)), 0);
        _assertFail(bob, abi.encodeCall(core.attack, (1, 1, 2)), 0);
        assertEq(token.allowance(bob, address(core)), 2);
        assertEq(token.balanceOf(bob), 2);
        assertEq(token.totalSupply(), 2);
    }

    function test_AllSixCoreWriteEntriesRejectNestedWithdrawalCallback() public {
        WithdrawalLockProbeBSCV2 recipient = new WithdrawalLockProbeBSCV2(core);
        _buy(alice, Q);
        _attack(alice, 1, 1);
        vm.warp(block.timestamp + T);
        core.settleLand(1);
        uint256 claimBefore = core.claimable(alice);
        uint256 accountedBefore = core.accountedBNB();
        uint256 supplyBefore = token.totalSupply();
        bytes32 war = _warState();
        vm.prank(alice);
        core.withdrawRewards(payable(address(recipient)), 1);
        assertEq(recipient.attempts(), 6);
        assertEq(recipient.successes(), 0);
        assertEq(recipient.wrongErrors(), 0);
        assertEq(address(recipient).balance, 1);
        assertEq(core.claimable(alice), claimBefore - WB);
        assertEq(core.accountedBNB(), accountedBefore - 1);
        assertEq(token.totalSupply(), supplyBefore);
        assertEq(_warState(), war);
        _assertAccounting();
    }

    function test_PassiveBNBIsNotRecognizedByAttackDefenseSettlementOrWithdrawal() public {
        _buy(alice, Q);
        _buy(bob, Q);
        _attack(alice, 1, 10);
        _donate(7);
        uint256 accounted = core.accountedBNB();
        vm.warp(block.timestamp + T);
        assertFalse(_attack(bob, 1, 1));
        _defend(bob, 1, 1);
        core.settleLand(1);
        assertEq(core.accountedBNB(), accounted);
        _withdraw(alice, 1);
        assertEq(address(core).balance - core.accountedBNB(), 7);
        _assertAccounting();
    }

    function test_SameEpochNaturalDecayChangesStrictThresholdWithoutLockingOldQuote() public {
        _buy(alice, 10);
        _buy(bob, 10);
        _attack(alice, 1, 10);
        assertEq(core.minimumAttackAtoms(1), 11);
        vm.warp(block.timestamp + H);
        (,,, uint256 epoch,) = core.lands(1);
        assertEq(epoch, 1);
        assertEq(core.minimumAttackAtoms(1), 6);
        vm.prank(bob);
        assertTrue(core.attack(1, epoch, 10));
        _land(1, bob, 5 * S, 2);
        _assertAccounting();
    }
}
