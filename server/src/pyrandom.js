// Python's random.Random (Mersenne Twister, version-2 seeding) in JavaScript.
//
// Decks, daily quests and bot behaviour were defined by Python's generator, and
// the golden vectors in shared/golden/hands.json were produced with it. This
// port gives the same numbers for the same seed, so a match seed deals the same
// hands it always did and both servers agree on today's quests.

import { createHash } from 'node:crypto';

const N = 624;
const M = 397;

function seedKey(seed) {
  // An int seeds with its absolute value; a str with int.from_bytes(s + sha512(s)).
  let big;
  if (typeof seed === 'number' || typeof seed === 'bigint') {
    big = BigInt(seed);
    if (big < 0n) big = -big;
  } else {
    const bytes = Buffer.from(String(seed), 'utf8');
    const all = Buffer.concat([bytes, createHash('sha512').update(bytes).digest()]);
    big = BigInt('0x' + all.toString('hex'));
  }
  const key = [];
  while (big > 0n) {
    key.push(Number(big & 0xffffffffn));
    big >>= 32n;
  }
  return key.length ? key : [0];
}

export class PyRandom {
  constructor(seed) {
    this.mt = new Uint32Array(N);
    this.mti = N + 1;
    this.gaussNext = null;
    this._initByArray(seedKey(seed));
  }

  _initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  _initByArray(key) {
    const mt = this.mt;
    this._initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  _genrand() {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      const y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** A float in [0, 1) with 53 random bits, as random.random(). */
  random() {
    const a = this._genrand() >>> 5;
    const b = this._genrand() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** k random bits: a Number for k <= 32, else a BigInt (low 32-bit words first, as CPython). */
  getrandbits(k) {
    if (k === 0) return 0;
    if (k <= 32) return this._genrand() >>> (32 - k);
    let out = 0n;
    let shift = 0n;
    for (let left = k; left > 0; left -= 32, shift += 32n) {
      let r = this._genrand();
      if (left < 32) r >>>= 32 - left;
      out |= BigInt(r) << shift;
    }
    return out;
  }

  /** A random int in [0, n). n may be a Number (below 2**53) or a BigInt; the result has the same type. */
  _randbelow(n) {
    if (typeof n === 'bigint') {
      const k = n.toString(2).length;
      const draw = () => BigInt(this.getrandbits(k));
      let r = draw();
      while (r >= n) r = draw();
      return r;
    }
    const k = n.toString(2).length;
    const draw = k <= 32 ? () => this.getrandbits(k) : () => Number(this.getrandbits(k));
    let r = draw();
    while (r >= n) r = draw();
    return r;
  }

  /** As random.randrange(start, stop) (or randrange(stop)); BigInt arguments give a BigInt. */
  randrange(start, stop) {
    if (stop === undefined) return this._randbelow(start);
    return start + this._randbelow(stop - start);
  }

  /** As random.sample(range(lo, hi), k) or random.sample(array, k). */
  sample(population, k) {
    const isRange = !Array.isArray(population) && typeof population !== 'string';
    const n = isRange ? population.hi - population.lo : population.length;
    const at = (j) => (isRange ? population.lo + j : population[j]);
    if (k < 0 || k > n) throw new RangeError('Sample larger than population or is negative');
    const result = new Array(k);
    let setsize = 21; // size of a small set minus the size of an empty list
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4)); // table size for big sets
    if (n <= setsize) {
      const pool = Array.from({ length: n }, (_, j) => at(j));
      for (let i = 0; i < k; i++) {
        const j = this._randbelow(n - i);
        result[i] = pool[j];
        pool[j] = pool[n - i - 1];
      }
    } else {
      const selected = new Set();
      for (let i = 0; i < k; i++) {
        let j = this._randbelow(n);
        while (selected.has(j)) j = this._randbelow(n);
        selected.add(j);
        result[i] = at(j);
      }
    }
    return result;
  }

  randint(a, b) {
    return this.randrange(a, b + 1);
  }

  choice(seq) {
    return seq[this._randbelow(seq.length)];
  }

  /** In place, as random.shuffle. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this._randbelow(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** One pick by weight, as random.choices(population, weights)[0]. */
  weightedChoice(population, weights) {
    const cum = [];
    let acc = 0;
    for (const w of weights) { acc += w; cum.push(acc); }
    const x = this.random() * (cum[cum.length - 1] + 0.0);
    let lo = 0;
    let hi = population.length - 1;
    while (lo < hi) {        // bisect_right(cum, x, 0, hi)
      const mid = (lo + hi) >> 1;
      if (x < cum[mid]) hi = mid; else lo = mid + 1;
    }
    return population[lo];
  }

  uniform(a, b) {
    return a + (b - a) * this.random();
  }

  gauss(mu, sigma) {
    let z = this.gaussNext;
    this.gaussNext = null;
    if (z === null) {
      const x2pi = this.random() * 2 * Math.PI;
      const g2rad = Math.sqrt(-2.0 * Math.log(1.0 - this.random()));
      z = Math.cos(x2pi) * g2rad;
      this.gaussNext = Math.sin(x2pi) * g2rad;
    }
    return mu + z * sigma;
  }
}
