import { describe, it, expect } from 'vitest';
import { DeterministicHmacStream } from '../src/core/randomizer/unbiased-sampler';

describe('DeterministicHmacStream & Unbiased Rejection Sampling', () => {
  it('should generate deterministic uint32 sequence for the same seed and context', () => {
    const stream1 = new DeterministicHmacStream('seed-123', 'ctx-abc');
    const stream2 = new DeterministicHmacStream('seed-123', 'ctx-abc');

    const seq1 = [stream1.nextUint32(), stream1.nextUint32(), stream1.nextUint32()];
    const seq2 = [stream2.nextUint32(), stream2.nextUint32(), stream2.nextUint32()];

    expect(seq1).toEqual(seq2);
  });

  it('should generate different sequence when context or seed changes', () => {
    const streamA = new DeterministicHmacStream('seed-123', 'ctx-abc');
    const streamB = new DeterministicHmacStream('seed-456', 'ctx-abc');

    expect(streamA.nextUint32()).not.toBe(streamB.nextUint32());
  });

  it('should strictly sample integers within the requested range', () => {
    const stream = new DeterministicHmacStream('test-seed-range', 'range-check');
    const range = 7;

    for (let i = 0; i < 500; i++) {
      const val = stream.sampleUnbiasedIndex(range);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(range);
    }
  });

  it('should demonstrate uniform distribution without modulo bias', () => {
    const stream = new DeterministicHmacStream('uniform-dist-seed', 'bias-test');
    const range = 5;
    const iterations = 10000;
    const counts = [0, 0, 0, 0, 0];

    for (let i = 0; i < iterations; i++) {
      const idx = stream.sampleUnbiasedIndex(range);
      counts[idx]++;
    }

    const expected = iterations / range; // 2000
    // Each bucket should be close to expected within +/- 10%
    for (let i = 0; i < range; i++) {
      const deviation = Math.abs(counts[i] - expected) / expected;
      expect(deviation).toBeLessThan(0.10);
    }
  });

  it('should handle edge cases: range = 1 and invalid range <= 0', () => {
    const stream = new DeterministicHmacStream('edge-seed', 'edge-test');
    expect(stream.sampleUnbiasedIndex(1)).toBe(0);
    expect(() => stream.sampleUnbiasedIndex(0)).toThrow(/Invalid sampling range/);
    expect(() => stream.sampleUnbiasedIndex(-5)).toThrow(/Invalid sampling range/);
  });
});
