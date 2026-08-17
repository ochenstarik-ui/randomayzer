import { createHmac } from 'crypto';

const UINT32_MAX = 0x100000000; // 2^32 = 4294967296

/**
 * Deterministic HMAC-SHA256 CSPRNG Stream with Unbiased Rejection Sampling.
 */
export class DeterministicHmacStream {
  private seed: string;
  private context: string;
  private counter: number = 0;

  constructor(seed: string, context: string) {
    this.seed = seed;
    this.context = context;
  }

  /**
   * Generates the next raw 32-bit unsigned integer from HMAC-SHA256 stream
   */
  nextUint32(): number {
    const hmac = createHmac('sha256', this.seed);
    hmac.update(`${this.context}:ctr:${this.counter++}`);
    const buffer = hmac.digest();
    return buffer.readUInt32BE(0);
  }

  /**
   * Generates an unbiased integer in range [0, range - 1] using Rejection Sampling.
   * Eliminates modulo bias completely.
   */
  sampleUnbiasedIndex(range: number): number {
    if (range <= 0) {
      throw new Error(`Invalid sampling range: ${range}`);
    }
    if (range === 1) {
      return 0;
    }

    // Largest multiple of range <= 2^32
    const maxValid = Math.floor(UINT32_MAX / range) * range;

    while (true) {
      const raw = this.nextUint32();
      if (raw < maxValid) {
        return raw % range;
      }
      // If raw >= maxValid, reject and retry to eliminate bias
    }
  }

  getStreamCounter(): number {
    return this.counter;
  }
}
