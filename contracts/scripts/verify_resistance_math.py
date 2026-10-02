#!/usr/bin/env python3
"""Generate/certify Resistance45 constants and independently bounded EVM vectors.

Only the standard library is used. Decimal supplies candidate constants and a
second numerical reference. Certification uses integer interval arithmetic,
atanh's positive series for ln(2), and alternating Taylor bounds for exp(-x).
No trust in a Decimal rounding guarantee is required by the certificate.
"""
from __future__ import annotations

import argparse
from decimal import Decimal, localcontext, ROUND_CEILING
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import random

H = 3_888_000
Q = 1 << 192
S = 1 << 512
SEED = 0x4253434255524E56324D415448
ROOT = Path(__file__).resolve().parents[1]


def ceildiv(a: int, b: int) -> int:
    return (a + b - 1) // b


def ln2_interval() -> tuple[int, int]:
    # ln2 = 2*atanh(1/3). N=200 positive terms, with geometric tail bound.
    n = 200
    lower = sum((2 * S) // ((2 * j + 1) * 3 ** (2 * j + 1)) for j in range(n))
    tail = ceildiv(9 * S, 4 * (2 * n + 1) * 3 ** (2 * n + 1))
    return lower, lower + n + tail


LN_LO, LN_HI = ln2_interval()


@lru_cache(maxsize=None)
def exp_fraction_interval(numerator: int) -> tuple[int, int]:
    """Rigorous S-scaled interval for 2^(-numerator/H), 0<=numerator<H.

    0<=x<ln2<1. P_160(x) is an upper bound for e^-x; P_161(x)
    is a lower bound. Every multiply/divide in each term has directed
    integer rounding, so the computed intervals enclose both polynomials.
    """
    assert 0 <= numerator < H
    if numerator == 0:
        return S, S
    xlo = LN_LO * numerator // H
    xhi = ceildiv(LN_HI * numerator, H)
    assert 0 < xlo <= xhi < S
    tlo = thi = S
    plo = phi = S
    upper = 0
    for n in range(1, 162):
        tlo = tlo * xlo // (S * n)
        thi = ceildiv(thi * xhi, S * n)
        if n & 1:
            plo, phi = plo - thi, phi - tlo
        else:
            plo, phi = plo + tlo, phi + thi
        if n == 160:
            upper = phi
    assert 0 < plo <= upper < S
    return plo, upper


def candidate_constants() -> list[int]:
    with localcontext() as ctx:
        ctx.prec = 180
        return [int((Decimal(Q) * (-(Decimal(2) ** b) / H * Decimal(2).ln()).exp())
                    .to_integral_value(rounding=ROUND_CEILING)) for b in range(22)]


def certify_constants(constants: list[int]) -> list[dict]:
    rows = []
    for bit, c in enumerate(constants):
        lo, hi = exp_fraction_interval(1 << bit)
        # Strict bounds certify c == ceil(Q*f), direction and <1 ULP error.
        assert (c - 1) * S < lo * Q <= hi * Q < c * S
        assert 0 < c < Q
        rows.append({"bit": bit, "seconds": 1 << bit, "constant": str(c),
                     "scaled_interval_lower": str(lo), "scaled_interval_upper": str(hi),
                     "ceil_is_certified": True})
    return rows


def algorithm(raw: int, dt: int, constants: list[int]) -> int:
    """Exact arbitrary-width integer rendition of the specified Q192 algorithm.

    This is used only for bit-exact parity. Independent interval/Decimal
    references below establish direction and error, not this model itself.
    """
    assert 0 <= raw < Q and dt >= 0
    if raw == 0 or dt == 0:
        return raw
    if dt >= 192 * H:
        return 1
    k, r = divmod(dt, H)
    factor = Q
    for bit, c in enumerate(constants):
        if r & (1 << bit):
            factor = ceildiv(factor * c, Q)
    return ceildiv(raw * factor, Q << k)


def real_ceil_certified(raw: int, dt: int) -> int:
    if raw == 0 or dt == 0:
        return raw
    k, r = divmod(dt, H)
    if k >= 192:
        return 1
    if r == 0:
        return ceildiv(raw, 1 << k)
    lo, hi = exp_fraction_interval(r)
    denominator = S << k
    lower_floor = raw * lo // denominator
    upper_floor = raw * hi // denominator
    # Equal integer parts prove the exact real ceiling, since 2^(-r/H)
    # is irrational for 0<r<H. This is checked separately for every vector.
    assert lower_floor == upper_floor
    return lower_floor + 1


def vectors(constants: list[int]) -> tuple[list[tuple[int, int, int, int]], dict]:
    samples: set[tuple[int, int]] = set()
    raw_values = [0, 1, 2, 3, (1 << 64) - 1, 1 << 64, (1 << 64) + 1,
                  10**16 << 64, 1_000 * 10**18 << 64, Q // 2, Q - 2, Q - 1]
    times = [0, 1, H - 1, H, H + 1, 2 * H, 2 * H + 1, 3 * H - 1,
             191 * H, 192 * H - 1, 192 * H, 193 * H, (1 << 64) - 1, (1 << 256) - 1]
    for raw in raw_values:
        for dt in times:
            samples.add((raw, dt))
    for bit in range(22):
        for raw in [1, 1 << 64, Q - 1]:
            samples.add((raw, 1 << bit))
    # Every period/shift branch at its exact boundary and nonzero remainder.
    for period in range(192):
        samples.add((Q - 1, period * H))
        samples.add((Q - 1, period * H + H - 1))
    rng = random.Random(SEED)
    for _ in range(512):
        samples.add((rng.randrange(Q), rng.randrange(193 * H)))
    for _ in range(256):
        samples.add((rng.randrange(Q), rng.randrange(H)))
    rows = []
    max_gap = 0
    for raw, dt in sorted(samples):
        result = algorithm(raw, dt, constants)
        ideal = real_ceil_certified(raw, dt)
        assert ideal <= result <= raw
        assert result - ideal <= 45
        if raw != 0:
            assert result > 0
        max_gap = max(max_gap, result - ideal)
        # An independent Decimal full exponential check on dt<192*H.
        # Integer half-life boundaries have exact rational references above;
        # do not use transcendental Decimal cancellation to test exact equality.
        if raw and 0 < dt < 192 * H and dt % H != 0:
            with localcontext() as ctx:
                ctx.prec = 180
                exact = Decimal(raw) * (-Decimal(dt) / H * Decimal(2).ln()).exp()
                assert Decimal(result) >= exact
                assert Decimal(result) - exact < 46
        rows.append((raw, dt, result, ideal))
    return rows, {"vectors": len(rows), "maximum_observed_result_minus_real_ceil": max_gap,
                  "random_seed_hex": hex(SEED), "random_draws": 768,
                  "method": "Exact integer algorithm parity plus separately certified real ceilings and Decimal cross-checks; samples are not the all-input proof."}


def constants_source(constants: list[int]) -> str:
    lines = ["// SPDX-License-Identifier: MIT", "pragma solidity 0.8.30;", "",
             "/// @dev Generated and independently interval-certified by scripts/verify_resistance_math.py.",
             "///      factor(bit) = ceil(2^192 * 2^(-2^bit / 3888000)), bit in [0,21].",
             "library ResistanceDecayConstantsBSC {",
             "    function factor(uint256 bit) internal pure returns (uint256) {"]
    lines.extend(f"        if (bit == {bit}) return {c};" for bit, c in enumerate(constants))
    lines += ["        revert(\"Resistance factor bit\");", "    }", "}", ""]
    return "\n".join(lines)


def micro_checkpoint_reference(constants: list[int]) -> dict:
    # Numerical history checks; the general m-checkpoint statement is analytic.
    # All three runs use the same 1-second checkpoints; no controller switch.
    count = 4096
    rows = []
    with localcontext() as ctx:
        ctx.prec = 180
        factor = (-Decimal(2).ln() / H).exp()
        for direction in [-1, 0, 1]:
            actual = Q // 2
            ideal = Decimal(actual)
            maximum = Decimal(0)
            for n in range(1, count + 1):
                actual = algorithm(actual, 1, constants) + direction * (1 << 64)
                ideal = ideal * factor + direction * (1 << 64)
                error = Decimal(actual) - ideal
                assert 0 <= error < 44 * n
                assert actual < Q // 2
                maximum = max(maximum, error)
            rows.append({"signed_atom_impulse": direction, "checkpoints": count,
                         "final_raw": str(actual), "maximum_observed_error_raw_ticks": str(maximum)})
    return {"type": "Decimal reference samples, not an EVM integration or all-history proof", "histories": rows}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="write certified source and fixtures")
    args = parser.parse_args()
    constants = candidate_constants()
    cert_rows = certify_constants(constants)
    rows, stats = vectors(constants)
    source = constants_source(constants).encode()
    binary = b"".join(value.to_bytes(32, "big") for row in rows for value in row)
    certificate = {"half_life_seconds": H, "factor_precision_bits": 192,
                   "interval_precision_bits": 512, "ln2_positive_series_terms": 200,
                   "exp_alternating_lower_degree": 161, "exp_alternating_upper_degree": 160,
                   "ln2_scaled_lower": str(LN_LO), "ln2_scaled_upper": str(LN_HI),
                   "certified_constants": cert_rows,
                   "all_input_bound": "0 <= output - raw*2^(-elapsed/H) < 44 < 46 raw ticks for 0 <= raw < 2^192; see analytical proof",
                   "vector_stats": stats,
                   "micro_checkpoint_reference": micro_checkpoint_reference(constants),
                   "vectors_sha256": hashlib.sha256(binary).hexdigest(),
                   "constants_source_sha256": hashlib.sha256(source).hexdigest()}
    targets = {
        ROOT / "src/libraries/ResistanceDecayConstantsBSC.sol": source,
        ROOT / "test/fixtures/resistance/vectors.bin": binary,
        ROOT / "evidence/resistance-math-certificate.json": (json.dumps(certificate, indent=2) + "\n").encode(),
    }
    for path, data in targets.items():
        if args.write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        else:
            assert path.read_bytes() == data, f"Generated artifact mismatch: {path}"
    print(json.dumps({"status": "PASS", "mode": "write" if args.write else "verify",
                      "constants_certified": len(constants), **stats,
                      "vectors_sha256": certificate["vectors_sha256"]}, indent=2))


if __name__ == "__main__":
    main()
