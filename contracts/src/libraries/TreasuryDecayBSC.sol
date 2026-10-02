// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TreasuryDecayConstantsBSC} from "./TreasuryDecayConstantsBSC.sol";

/// @notice Deterministic, upward-rounded 60-day treasury decay.
/// @dev The integer-interval derivation and exhaustive remainder certificate are
///      reproduced by scripts/verify_treasury_decay.py. Amounts use Core's 1/B wei.
library TreasuryDecayBSC {
    uint256 internal constant T = 60 days;
    uint256 internal constant MAX_U = 1 << 224;

    error TreasuryAmountOutOfRange();

    function remainingUpper(uint256 u0, uint64 dt) internal pure returns (uint256) {
        if (u0 >= MAX_U) revert TreasuryAmountOutOfRange();
        if (u0 == 0 || dt == 0) return u0;
        if (uint256(dt) >= 224 * T) return 1;

        uint256 periods = uint256(dt) / T;
        uint256 remainder = uint256(dt) % T;
        if (remainder == 0) {
            uint256 denominator = 1 << periods;
            return (u0 >> periods) + (u0 % denominator == 0 ? 0 : 1);
        }

        // For 0<remainder<T the real fractional factor is irrational, hence
        // ceil(Q256*f/2^periods) = (floor(Q256*f) >> periods) + 1.
        uint256 p = (_fractionFloor(remainder) >> periods) + 1;
        (uint256 high, uint256 low) = _fullMul(u0, p);
        return high + (low == 0 ? 0 : 1);
    }

    /// @dev Exact floor(2^256 * 2^(-remainder/T)) for integer 0<remainder<T.
    function _fractionFloor(uint256 remainder) internal pure returns (uint256) {
        // Q320 value is hi*2^256+lo. 2^320 represents one.
        uint256 hi = 1 << 64;
        uint256 lo;
        uint256 bit;
        while (remainder != 0) {
            if (remainder & 1 != 0) {
                (uint256 factorHi, uint256 factorLo) = TreasuryDecayConstantsBSC.factor(bit);
                (hi, lo) = _mul320(hi, lo, factorHi, factorLo);
            }
            remainder >>= 1;
            ++bit;
        }

        // Real Q320 value is in [hi:lo, hi:lo+46). All 5,183,999 valid
        // remainders have a certified margin >=46 before the next Q256 integer.
        // This assertion is unreachable for valid remainders; no fallback exp.
        assert(uint64(lo) <= type(uint64).max - 45);
        return (hi << 192) | (lo >> 64);
    }

    /// @dev floor((aHi:aLo)*(bHi:bLo)/2^320). Both operands are <=2^320.
    ///      Carries are explicit, so unchecked operations only wrap base-2^256 limbs.
    function _mul320(uint256 aHi, uint256 aLo, uint256 bHi, uint256 bLo) private pure returns (uint256 hi, uint256 lo) {
        // Reuse hi as the middle limb and lo as the upper limb until the shift.
        (hi,) = _fullMul(aLo, bLo);
        unchecked {
            lo = aHi * bHi;
            {
                (uint256 crossHi, uint256 crossLo) = _fullMul(aHi, bLo);
                uint256 next = hi + crossLo;
                lo += crossHi + (next < hi ? 1 : 0);
                hi = next;
            }
            {
                (uint256 crossHi, uint256 crossLo) = _fullMul(aLo, bHi);
                uint256 next = hi + crossLo;
                lo += crossHi + (next < hi ? 1 : 0);
                hi = next;
            }
            return (lo >> 64, (lo << 192) | (hi >> 64));
        }
    }

    function _fullMul(uint256 a, uint256 b) private pure returns (uint256 hi, uint256 lo) {
        assembly ("memory-safe") {
            let mm := mulmod(a, b, not(0))
            lo := mul(a, b)
            hi := sub(sub(mm, lo), lt(mm, lo))
        }
    }
}
