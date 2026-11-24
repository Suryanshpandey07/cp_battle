// Injectable clocks. Match actors schedule every timer through a Clock so tests
// can drive time deterministically with FakeClock.advance().

export class RealClock {
  nowMs() {
    return Math.floor(performance.now());
  }

  wallMs() {
    return Date.now();
  }

  callLater(delayS, fn) {
    const t = setTimeout(fn, Math.max(0, delayS) * 1000);
    if (t.unref) t.unref();
    return { cancel: () => clearTimeout(t) };
  }
}

/** Time only moves when a test calls advance(). */
export class FakeClock {
  constructor(startMs = 1_000_000, wallStartMs = 1_790_000_000_000) {
    this.now = startMs;
    this.wall0 = wallStartMs - startMs;
    this.heap = [];
    this.seq = 0;
  }

  nowMs() {
    return this.now;
  }

  wallMs() {
    return this.wall0 + this.now;
  }

  callLater(delayS, fn) {
    const h = { cancelled: false, cancel() { this.cancelled = true; } };
    this.heap.push({ due: this.now + Math.round(Math.max(0, delayS) * 1000), seq: this.seq++, h, fn });
    this.heap.sort((a, b) => a.due - b.due || a.seq - b.seq);
    return h;
  }

  /** Move time forward, firing due timers in order. Returns how many fired. */
  advance(seconds) {
    const target = this.now + Math.round(seconds * 1000);
    let fired = 0;
    while (this.heap.length && this.heap[0].due <= target) {
      const e = this.heap.shift();
      this.now = Math.max(this.now, e.due);
      if (!e.h.cancelled) {
        e.fn();
        fired++;
      }
    }
    this.now = target;
    return fired;
  }

  pending() {
    return this.heap.filter((e) => !e.h.cancelled).length;
  }
}
