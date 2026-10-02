// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ResistanceDecayBSC} from "../src/libraries/ResistanceDecayBSC.sol";
import {ResistanceDecayConstantsBSC} from "../src/libraries/ResistanceDecayConstantsBSC.sol";

contract ResistanceDecayHarness {
    function decay(uint256 raw, uint256 elapsed) external pure returns (uint256) {
        return ResistanceDecayBSC.remainingUpper(raw, elapsed);
    }

    function factor(uint256 bit) external pure returns (uint256) {
        return ResistanceDecayConstantsBSC.factor(bit);
    }
}

contract ResistanceDecayTest is Test {
    uint256 private constant H = 45 days;
    uint256 private constant Q = 1 << 192;
    uint256 private constant ATOM = 1 << 64;
    ResistanceDecayHarness private harness;

    function setUp() public {
        harness = new ResistanceDecayHarness();
    }

    function testCertifiedReferenceVectorsFirstQuarter() public view { _vectors(0, 344); }
    function testCertifiedReferenceVectorsSecondQuarter() public view { _vectors(344, 688); }
    function testCertifiedReferenceVectorsThirdQuarter() public view { _vectors(688, 1032); }
    function testCertifiedReferenceVectorsLastQuarter() public view { _vectors(1032, 1376); }

    function _vectors(uint256 start, uint256 end) private view {
        bytes memory fixture = vm.readFileBinary("test/fixtures/resistance/vectors.bin");
        assertEq(fixture.length, 1376 * 128, "certified vector count");
        for (uint256 i = start; i < end; ++i) {
            uint256 raw;
            uint256 elapsed;
            uint256 expected;
            uint256 realCeil;
            assembly ("memory-safe") {
                let p := add(add(fixture, 32), mul(i, 128))
                raw := mload(p)
                elapsed := mload(add(p, 32))
                expected := mload(add(p, 64))
                realCeil := mload(add(p, 96))
            }
            uint256 actual = harness.decay(raw, elapsed);
            assertEq(actual, expected, "arbitrary-width integer parity");
            assertGe(actual, realCeil, "independent rigorous real ceiling");
            assertLe(actual - realCeil, 45, "strictly less than 46 raw ticks");
            assertLe(actual, raw, "cannot enlarge input");
        }
    }

    function testWholeHalfLifeExactAndOddRounding() public view {
        assertEq(harness.decay(1_000 ether << 64, H), 500 ether << 64);
        assertEq(harness.decay(1_000 ether << 64, 2 * H), 250 ether << 64);
        assertEq(harness.decay(3, H), 2);
        assertEq(harness.decay(5, 2 * H), 2);
        assertEq(harness.decay(Q - 1, H), Q / 2);
        assertEq(harness.decay(Q - 1, 191 * H), 2);
    }

    function testMicroTopUpDoesNotReviveOldWallNumericalExample() public view {
        uint256 oldWall = harness.decay(1_000 ether << 64, H);
        uint256 topped = oldWall + (0.01 ether << 64);
        assertEq(topped, 500.01 ether << 64);
        uint256 attacked = (1_000 ether - 400 ether) << 64;
        assertEq(harness.decay(attacked, H), 300 ether << 64);
    }

    function testFractionalExcessIsPreserved() public view {
        uint256 wall = harness.decay(ATOM, 1);
        assertGt(wall, 0);
        assertLt(wall, ATOM);
        uint256 excess = ATOM - wall;
        assertGt(excess, 0);
        assertLt(excess, ATOM);
        assertEq(harness.decay(excess, 0), excess);
    }

    function testNonzeroTailAndUint256TimeDomain() public view {
        assertEq(harness.decay(Q - 1, 192 * H), 1);
        assertEq(harness.decay(Q - 1, type(uint256).max), 1);
        assertEq(harness.decay(0, type(uint256).max), 0);
        assertLt(harness.decay(Q - 1, type(uint256).max), ATOM);
    }

    function testConstantsAllTwentyTwoBitsAndInvalidBit() public {
        uint256 previous = Q;
        for (uint256 i; i < 22; ++i) {
            uint256 c = harness.factor(i);
            assertGt(c, Q / 2);
            assertLt(c, previous);
            previous = c;
        }
        vm.expectRevert(bytes("Resistance factor bit"));
        harness.factor(22);
    }

    function testRejectRawAtAndBeyondExplicitLimit() public {
        vm.expectRevert(ResistanceDecayBSC.ResistanceAmountOutOfRange.selector);
        harness.decay(Q, 0);
        vm.expectRevert(ResistanceDecayBSC.ResistanceAmountOutOfRange.selector);
        harness.decay(type(uint256).max, type(uint256).max);
    }

    function testFuzzIdentityAndRange(uint192 raw, uint256 elapsed) public view {
        assertEq(harness.decay(raw, 0), raw);
        uint256 result = harness.decay(raw, elapsed);
        assertLe(result, raw);
        assertLt(result, Q);
        if (raw > 0) assertGt(result, 0);
    }

    function testFuzzAllExactIntegerPeriodShifts(uint192 raw, uint8 shiftInput) public view {
        uint256 shift = uint256(shiftInput) % 192;
        uint256 denominator = uint256(1) << shift;
        uint256 expected = uint256(raw) / denominator + (uint256(raw) % denominator == 0 ? 0 : 1);
        assertEq(harness.decay(raw, shift * H), expected);
    }

    function testFuzzMonotoneElapsed(uint192 raw, uint64 first, uint64 delta) public view {
        assertLe(harness.decay(raw, uint256(first) + delta), harness.decay(raw, first));
    }

    function testFuzzNearTermMonotoneAndSplitErrorBound(uint192 raw, uint32 first, uint32 second) public view {
        uint256 a = uint256(first) % (192 * H);
        uint256 b = uint256(second) % (192 * H);
        uint256 firstResult = harness.decay(raw, a);
        uint256 twice = harness.decay(firstResult, b);
        uint256 once = harness.decay(raw, a + b);
        assertLe(twice, firstResult);
        assertLe(once, firstResult);
        uint256 difference = twice >= once ? twice - once : once - twice;
        assertLt(difference, 88, "two checkpoints have bounded accumulated rounding");
    }

    function testFuzzSameSecondSplitsAreIdentical(uint128 atomsInput, uint64 first, uint64 second) public view {
        uint256 raw = uint256(atomsInput) << 64;
        uint256 decayed = harness.decay(raw, H - 1);
        uint256 room = Q - 1 - decayed;
        uint256 addition = (uint256(first) + second) << 64;
        if (addition > room) return;
        uint256 together = decayed + addition;
        uint256 split = harness.decay(decayed + (uint256(first) << 64), 0) + (uint256(second) << 64);
        assertEq(split, together);
    }
}
