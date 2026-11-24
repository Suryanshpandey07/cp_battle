// In-memory token buckets behind a small interface so Redis can replace them.

import { AppError } from './errors.js';

export class MemoryRateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  /** Returns [allowed, retryAfterSeconds]. bucket: {capacity, per_s} */
  hit(key, bucket, cost = 1) {
    const now = performance.now() / 1000;
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: bucket.capacity, updated: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(bucket.capacity, b.tokens + (now - b.updated) * bucket.per_s);
    b.updated = now;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return [true, 0];
    }
    const retry = bucket.per_s > 0 ? (cost - b.tokens) / bucket.per_s : 60;
    if (this.buckets.size > 50_000) this.buckets.clear(); // crude memory guard
    return [false, retry];
  }

  reset() {
    this.buckets.clear();
  }
}

export const limiter = new MemoryRateLimiter();

export function enforce(key, bucket) {
  const [ok, retry] = limiter.hit(key, bucket);
  if (!ok) throw new AppError('rate_limited', 'Too many requests, slow down', { retry_after: Math.round(retry * 100) / 100 });
}
