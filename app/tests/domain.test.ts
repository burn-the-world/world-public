import { describe, expect, it } from 'vitest';
import { zeroAddress, type Address } from 'viem';
import { B, W, RESISTANCE_Q, MAX_WAR_ATOMS, RESISTANCE_LIMIT, REWARD_DENOMINATOR, minimumAttackAtoms, formatResistance, defendPreview, attackPreview, byteLength, validateProfileInput, formatNative, formatNumerator, formatScaledNative, formatWorld, hourlyReleaseReference, isNeutral, numeratorToWei, parseWorld, pendingNumerator, treasuryParts, weightOf, type Land } from '../src/domain';

const land: Land = { id: 1, weight: 6n, controller: zeroAddress, resistanceRaw: parseWorld('100') * RESISTANCE_Q, currentResistanceRaw: parseWorld('100') * RESISTANCE_Q, lastResistanceUpdate: 0n, minimumAttackAtoms: parseWorld('100') + 1n, epoch: 0n, j: 20n * B };
describe('production contract display arithmetic', () => {
  it('matches all 50 LAND weights and W=65', () => {
    const weights = Array.from({ length: 50 }, (_, i) => weightOf(i + 1));
    expect(weights.reduce((a, b) => a + b, 0n)).toBe(W);
    expect([weightOf(1), weightOf(2), weightOf(6), weightOf(7), weightOf(50)]).toEqual([6n, 3n, 3n, 1n, 1n]);
    expect(() => weightOf(0)).toThrow(); expect(() => weightOf(51)).toThrow();
  });
  it('computes strict Q64 crossing including fractional sub-atom walls', () => {
    expect(minimumAttackAtoms(0n)).toBe(1n);
    expect(minimumAttackAtoms(1n)).toBe(1n);
    expect(minimumAttackAtoms(RESISTANCE_Q)).toBe(2n);
    expect(minimumAttackAtoms(RESISTANCE_Q + 1n)).toBe(2n);
    expect(attackPreview({ currentResistanceRaw: RESISTANCE_Q - 1n }, 1n)).toMatchObject({ taken: true, newResistanceRaw: 1n, minimum: 1n });
    expect(formatResistance(1n)).not.toBe('0');
    expect(formatResistance(RESISTANCE_Q / 2n)).toBe('0.0000000000000000005');
    expect(formatResistance(0n)).toBe('0');
  });
  it('checks exclusive input and wall boundaries without truncation', () => {
    expect(minimumAttackAtoms(RESISTANCE_LIMIT - 1n)).toBe(MAX_WAR_ATOMS);
    expect(attackPreview({ currentResistanceRaw: 0n }, MAX_WAR_ATOMS - 1n).taken).toBe(true);
    for (const amount of [0n, -1n, MAX_WAR_ATOMS]) expect(() => attackPreview(land, amount)).toThrow();
    expect(() => defendPreview({ currentResistanceRaw: RESISTANCE_LIMIT - RESISTANCE_Q }, 1n)).toThrow();
    expect(defendPreview({ currentResistanceRaw: RESISTANCE_Q / 2n }, 1n).newResistanceRaw).toBe(RESISTANCE_Q * 3n / 2n);
  });
  it('distinguishes treasury units and ignores unrecognized donations', () => {
    const treasury = treasuryParts(7n * B + B / 2n, 10n);
    expect(treasury.unreleasedWei).toBe(7n);
    expect(treasury.releasedWei).toBe(2n);
    expect(treasury.releasedScaled).toBe(5n * B / 2n);
    expect(formatScaledNative(B)).toBe('0.000000000000000001');
    expect(() => treasuryParts(11n * B, 10n)).toThrow();
  });
  it('floors withdrawal and preserves sub-wei reward numerator', () => {
    const numerator = 31n * REWARD_DENOMINATOR + 27n;
    expect(numeratorToWei(numerator)).toBe(31n);
    expect(numerator - numeratorToWei(numerator) * REWARD_DENOMINATOR).toBe(27n);
    expect(numeratorToWei(REWARD_DENOMINATOR - 1n)).toBe(0n);
    expect(formatNumerator(REWARD_DENOMINATOR / 2n)).toBe('0.0000000000000000005');
    expect(formatNumerator(1n)).toMatch(/^<0\./);
  });
  it('labels neutral treasure separately from controlled pending, with same numerator arithmetic', () => {
    expect(isNeutral(land)).toBe(true);
    expect(pendingNumerator(land, 30n * B)).toBe(60n * B);
    const controlled = { ...land, controller: '0x0000000000000000000000000000000000000001' as Address };
    expect(isNeutral(controlled)).toBe(false);
    expect(pendingNumerator(controlled, 30n * B)).toBe(60n * B);
    expect(() => pendingNumerator(land, 0n)).toThrow();
  });
  it('parses atoms exactly and rejects silent rounding/scientific notation', () => {
    expect(parseWorld('100.000000000000000001')).toBe(100n * 10n ** 18n + 1n);
    expect(formatWorld(1n)).toBe('0.000000000000000001');
    expect(formatNative(1n)).toBe('0.000000000000000001');
    for (const text of ['1.0000000000000000001', '1e3', '0', '-1', 'Infinity', '', '0x100']) expect(() => parseWorld(text)).toThrow();
  });
  it('equal burns only zero the wall; strict excess is the new Q64 wall', () => {
    expect(attackPreview(land, parseWorld('100'))).toMatchObject({ taken: false, equal: true, newResistanceRaw: 0n, burn: parseWorld('100') });
    expect(attackPreview(land, parseWorld('100') + 1n)).toMatchObject({ taken: true, equal: false, newResistanceRaw: RESISTANCE_Q, minimum: parseWorld('100') + 1n });
    expect(attackPreview(land, parseWorld('120'))).toMatchObject({ taken: true, newResistanceRaw: parseWorld('20') * RESISTANCE_Q, burn: parseWorld('120') });
  });
  it('hourly release is an explicitly approximate read-only reference', () => {
    expect(hourlyReleaseReference(0n)).toBe(0n);
    const coefficient = Number(hourlyReleaseReference(10n ** 18n)) / 1e18;
    expect(Math.abs(coefficient - (1 - 2 ** (-1 / 1440)))).toBeLessThan(1e-12);
  });
  it('uses the provided chain reward denominator without rounding up', () => {
    expect(numeratorToWei(28n, 10n)).toBe(2n);
    expect(formatNumerator(15n, 10n)).toBe('0.0000000000000000015');
    expect(() => numeratorToWei(1n, 0n)).toThrow();
  });
  it('checks UTF-8 byte limits and accepts all-empty Profile', () => {
    const limits = { name: 64, logoURI: 256, website: 256 };
    expect(byteLength('天才明')).toBe(9);
    expect(byteLength('😀'.repeat(16))).toBe(64);
    expect(() => validateProfileInput({ name: '天'.repeat(21) + 'a', logoURI: '', website: '' }, limits)).not.toThrow();
    expect(() => validateProfileInput({ name: '天'.repeat(22), logoURI: '', website: '' }, limits)).toThrow(/64/);
    expect(() => validateProfileInput({ name: '', logoURI: '', website: '' }, limits)).not.toThrow();
  });
});
