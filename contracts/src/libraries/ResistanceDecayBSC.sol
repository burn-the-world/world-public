// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ResistanceDecayConstantsBSC} from "./ResistanceDecayConstantsBSC.sol";

/// @notice Upward-rounded 45-day decay of Q64 WORLD-atom Resistance.
/// @dev Independent of the 60-day Treasury library. See the integer interval
///      certificate and all-input error proof in BSC_BURN_V2_RESISTANCE_MATH.md.
library ResistanceDecayBSC {
    uint256 internal constant H = 45 days;
    uint256 internal constant MAX_RAW = 1 << 192;

    error ResistanceAmountOutOfRange();

    /// @dev Valid raw values are [0, 2^192). elapsed supports the entire uint256
    ///      domain; the caller must reject a timestamp preceding its anchor.
    function remainingUpper(uint256 raw, uint256 elapsed) internal pure returns (uint256) {
        if (raw >= MAX_RAW) revert ResistanceAmountOutOfRange();
        if (raw == 0 || elapsed == 0) return raw;
        if (elapsed >= 192 * H) return 1;

        uint256 periods = elapsed / H;
        uint256 remainder = elapsed % H;
        if (remainder == 0) return _ceilShift(raw, periods);

        uint256 factor = MAX_RAW;
        uint256 bit;
        while (remainder != 0) {
            if (remainder & 1 != 0) {
                factor = _mulQ192Up(factor, ResistanceDecayConstantsBSC.factor(bit));
            }
            remainder >>= 1;
            ++bit;
        }

        // ceil(ceil(raw*factor/Q)/2^periods) is exactly
        // ceil(raw*factor/(Q*2^periods)); this adds no extra rounding step.
        return _ceilShift(_mulQ192Up(raw, factor), periods);
    }

    /// @dev a,b <= 2^192; their product fits 384 bits. The high limb is at
    ///      most 2^128, so the shifted quotient fits uint256 (and <=2^192).
    function _mulQ192Up(uint256 a, uint256 b) private pure returns (uint256 result) {
        uint256 high;
        uint256 low;
        assembly ("memory-safe") {
            let mm := mulmod(a, b, not(0))
            low := mul(a, b)
            high := sub(sub(mm, low), lt(mm, low))
        }
        result = (high << 64) | (low >> 192);
        if ((low & (MAX_RAW - 1)) != 0) ++result;
    }

    /// @dev bits is in [0,191], and value is at most 2^192.
    function _ceilShift(uint256 value, uint256 bits) private pure returns (uint256) {
        uint256 mask = (uint256(1) << bits) - 1;
        return (value >> bits) + ((value & mask) == 0 ? 0 : 1);
    }
}
