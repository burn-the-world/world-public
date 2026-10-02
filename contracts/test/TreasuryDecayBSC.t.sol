// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {TreasuryDecayBSC} from "../src/libraries/TreasuryDecayBSC.sol";
import {TreasuryDecayVectorsBSC} from "./fixtures/TreasuryDecayVectorsBSC.sol";

contract TreasuryDecayHarnessBSC {
    function remainingUpper(uint256 amount, uint64 elapsed) external pure returns (uint256) {
        return TreasuryDecayBSC.remainingUpper(amount, elapsed);
    }

    function fractionFloor(uint256 remainder) external pure returns (uint256) {
        require(remainder > 0 && remainder < 60 days);
        return TreasuryDecayBSC._fractionFloor(remainder);
    }
}

contract TreasuryDecayBSCTest is Test {
    uint256 private constant T = 60 days;
    uint256 private constant MAX_U = (1 << 224) - 1;
    TreasuryDecayHarnessBSC private decay;

    function setUp() public {
        decay = new TreasuryDecayHarnessBSC();
    }

    function test_ZeroAmountAndZeroElapsedAreExact() public view {
        assertEq(decay.remainingUpper(0, 0), 0);
        assertEq(decay.remainingUpper(0, 1), 0);
        assertEq(decay.remainingUpper(0, type(uint64).max), 0);
        assertEq(decay.remainingUpper(MAX_U, 0), MAX_U);
        assertEq(decay.remainingUpper(1, 0), 1);
    }

    function test_AmountsAtOrAbove224BitsAreRejected() public {
        vm.expectRevert(TreasuryDecayBSC.TreasuryAmountOutOfRange.selector);
        decay.remainingUpper(1 << 224, 0);
        vm.expectRevert(TreasuryDecayBSC.TreasuryAmountOutOfRange.selector);
        decay.remainingUpper(type(uint256).max, type(uint64).max);
    }

    function test_EveryIntegralHalfLifeUsesExactCeiling() public view {
        uint256[5] memory amounts = [uint256(1), 2, 3, uint256(1 << 223), MAX_U];
        for (uint256 period = 1; period < 224; ++period) {
            uint256 divisor = 1 << period;
            for (uint256 j; j < amounts.length; ++j) {
                uint256 amount = amounts[j];
                uint256 expected = amount / divisor + (amount % divisor == 0 ? 0 : 1);
                assertEq(decay.remainingUpper(amount, uint64(period * T)), expected);
            }
        }
    }

    function test_TailCutoffAndMaximumUint64AreExact() public view {
        assertEq(decay.remainingUpper(MAX_U, uint64(224 * T - 1)), 2);
        assertEq(decay.remainingUpper(MAX_U, uint64(224 * T)), 1);
        assertEq(decay.remainingUpper(MAX_U, uint64(224 * T + 1)), 1);
        assertEq(decay.remainingUpper(MAX_U, type(uint64).max), 1);
        assertEq(decay.remainingUpper(1, type(uint64).max), 1);
    }

    function test_IndependentIntegerIntervalFractionVectors() public view {
        bytes memory vectors = TreasuryDecayVectorsBSC.fractions();
        assertEq(vectors.length % 35, 0);
        assertGt(vectors.length / 35, 150);
        for (uint256 offset; offset < vectors.length; offset += 35) {
            uint256 remainder;
            uint256 expected;
            assembly ("memory-safe") {
                remainder := shr(232, mload(add(add(vectors, 32), offset)))
                expected := mload(add(add(vectors, 35), offset))
            }
            assertEq(decay.fractionFloor(remainder), expected, "Q256 floor differs from interval reference");
        }
    }

    function test_IndependentIntegerIntervalRemainingVectors() public view {
        bytes memory vectors = TreasuryDecayVectorsBSC.remaining();
        assertEq(vectors.length % 64, 0);
        assertGt(vectors.length / 64, 150);
        for (uint256 offset; offset < vectors.length; offset += 64) {
            uint256 amount;
            uint64 elapsed;
            uint256 expected;
            assembly ("memory-safe") {
                amount := shr(32, mload(add(add(vectors, 32), offset)))
                elapsed := shr(192, mload(add(add(vectors, 60), offset)))
                expected := shr(32, mload(add(add(vectors, 68), offset)))
            }
            assertEq(
                decay.remainingUpper(amount, elapsed), expected, "remaining amount differs from interval reference"
            );
        }
    }

    function test_MonotoneAcrossEveryPeriodBoundary() public view {
        for (uint256 period = 1; period <= 224; ++period) {
            uint64 boundary = uint64(period * T);
            uint256 before = decay.remainingUpper(MAX_U, boundary - 1);
            uint256 at = decay.remainingUpper(MAX_U, boundary);
            uint256 after_ = decay.remainingUpper(MAX_U, boundary + 1);
            assertGe(before, at);
            assertGe(at, after_);
        }
    }

    function testFuzz_RemainingIsNonincreasingInTime(uint224 amount, uint64 first, uint64 second) public view {
        first = uint64(bound(first, 0, 225 * T));
        second = uint64(bound(second, first, 225 * T));
        uint256 initial = uint256(amount);
        uint256 earlier = decay.remainingUpper(initial, first);
        uint256 later = decay.remainingUpper(initial, second);
        assertLe(earlier, initial);
        assertLe(later, earlier);
        if (initial > 0) assertGe(later, 1);
    }

    function testFuzz_RemainingIsNondecreasingInAmount(uint224 first, uint224 second, uint64 elapsed) public view {
        uint256 smaller = uint256(first);
        uint256 larger = bound(uint256(second), smaller, MAX_U);
        elapsed = uint64(bound(elapsed, 0, 225 * T));
        assertLe(decay.remainingUpper(smaller, elapsed), decay.remainingUpper(larger, elapsed));
    }

    function testFuzz_FractionIsStrictlyDecreasing(uint32 first, uint32 gap) public view {
        uint256 smaller = bound(uint256(first), 1, T - 2);
        uint256 larger = bound(uint256(gap), smaller + 1, T - 1);
        assertGt(decay.fractionFloor(smaller), decay.fractionFloor(larger));
    }

    function testFuzz_IdenticalInputsAreDeterministic(uint224 amount, uint64 elapsed) public view {
        uint256 first = decay.remainingUpper(amount, elapsed);
        uint256 second = decay.remainingUpper(amount, elapsed);
        assertEq(first, second);
    }
}
