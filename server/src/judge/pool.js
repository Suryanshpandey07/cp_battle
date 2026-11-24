// Bounded judge worker pool.
//
// JUDGE_CONCURRENCY workers pull jobs in priority order: match submits first,
// then Runs, then practice. At most max_queued jobs wait; beyond that callers get
// `busy`. A job that waits longer than queue_timeout_s, overruns job_timeout_s,
// or hits a runner failure returns a system error (no recoil).

import { AppError } from '../errors.js';
import { log } from '../log.js';
import { pyRound } from '../util.js';

const systemError = (message) => ({ compile_error: null, system_error: true, system_message: message, verdicts: [] });
const noProgress = async () => {};

export class JudgePool {
  constructor(runner, { concurrency, maxQueued, queueTimeoutS, jobTimeoutS }) {
    this.runner = runner;
    this.concurrency = Math.max(1, concurrency);
    this.maxQueued = maxQueued;
    this.queueTimeoutS = queueTimeoutS;
    this.jobTimeoutS = jobTimeoutS;
    this.items = []; // kept sorted by (priority, seq)
    this.seq = 0;
    this.active = 0;
    this.stopped = false;
    this.metrics = { jobs: 0, system_errors: 0, last_wait_ms: 0, total_wait_ms: 0, total_run_ms: 0 };
  }

  get name() {
    return this.runner.name;
  }

  get sandboxed() {
    return this.runner.sandboxed;
  }

  get queued() {
    return this.items.length;
  }

  get idle() {
    return this.items.length === 0 && this.active === 0;
  }

  snapshot() {
    const n = Math.max(1, this.metrics.jobs);
    return {
      queued: this.queued, jobs: this.metrics.jobs, system_errors: this.metrics.system_errors,
      avg_wait_ms: pyRound(this.metrics.total_wait_ms / n, 1), avg_run_ms: pyRound(this.metrics.total_run_ms / n, 1),
    };
  }

  stop() {
    this.stopped = true;
    for (const it of this.items.splice(0)) it.resolve(systemError('judge stopped'));
  }

  submit(job, priority, onProgress = noProgress) {
    if (this.items.length >= this.maxQueued) return Promise.reject(new AppError('busy', 'The judge queue is full, try again shortly'));
    return new Promise((resolve) => {
      const item = { priority, seq: this.seq++, enqueued: performance.now(), job, onProgress, resolve };
      let i = this.items.length;
      while (i > 0 && (this.items[i - 1].priority > priority)) i--;
      this.items.splice(i, 0, item);
      this._pump();
    });
  }

  _pump() {
    while (!this.stopped && this.active < this.concurrency && this.items.length) {
      const item = this.items.shift();
      this.active++;
      this._work(item).finally(() => {
        this.active--;
        this._pump();
      });
    }
  }

  async _work(item) {
    const waited = performance.now() - item.enqueued;
    this.metrics.last_wait_ms = Math.trunc(waited);
    this.metrics.total_wait_ms += Math.trunc(waited);
    let res;
    if (waited > this.queueTimeoutS * 1000) {
      res = systemError('judge queue timeout');
    } else {
      const t0 = performance.now();
      const ctl = new AbortController();
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
          ctl.abort();
          resolve(systemError('judge job timeout'));
        }, this.jobTimeoutS * 1000);
      });
      try {
        res = await Promise.race([this.runner.run(item.job, item.onProgress, ctl.signal), timeout]);
      } catch (e) { // runner failure: void, no recoil
        log.error('runner failure', { error: String(e && e.stack ? e.stack : e) });
        res = systemError('judge runner failure');
      } finally {
        clearTimeout(timer);
      }
      this.metrics.total_run_ms += Math.trunc(performance.now() - t0);
    }
    this.metrics.jobs++;
    if (res.system_error) this.metrics.system_errors++;
    item.resolve(res);
  }
}
