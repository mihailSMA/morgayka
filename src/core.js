/* Pure timing rules, shared by the browser and Node's built-in test runner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StimulusCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({ minHz: 1, maxHz: 20, hzStep: 0.5, minSeconds: 5, maxSeconds: 120, secondsStep: 5 });
  function validate(hz, seconds) {
    if (!Number.isFinite(hz) || hz < 1 || hz > 20 || !Number.isInteger(hz * 2)) {
      throw new RangeError('Частота: от 1 до 20 Гц с шагом 0,5.');
    }
    if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120 || seconds % 5 !== 0) {
      throw new RangeError('Длительность: от 5 до 120 секунд с шагом 5.');
    }
    return Object.freeze({ hz, seconds });
  }
  // Absolute elapsed time prevents cumulative timer drift. Black is the first phase.
  function phaseAt(elapsedMs, hz) {
    return Math.floor(Math.max(0, elapsedMs) * hz * 2 / 1000) % 2 === 0 ? 'black' : 'red';
  }
  function summarize(intervals) {
    if (!intervals.length) return null;
    const sorted = [...intervals].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return Object.freeze({ samples: sorted.length, median, max: sorted.at(-1), late: sorted.filter(value => value > median * 1.5).length });
  }
  class Session {
    constructor(adapter) { this.adapter = adapter; this.state = 'idle'; this.token = 0; }
    async start(config, demo = false) {
      if (this.state !== 'idle' || this.pendingEnter) return false;
      validate(config.hz, config.seconds);
      this.state = 'requesting'; this.pendingEnter = true;
      const token = ++this.token;
      this.config = { ...config }; this.demo = demo; this.intervals = []; this.previous = null; this.started = null;
      try {
        // Must be called synchronously from the user's click before awaiting anything.
        await this.adapter.enter();
        this.pendingEnter = false;
        if (this.token !== token) {
          // A late fullscreen grant after cancellation must not leave the page fullscreen.
          if (this.state === 'idle') this.adapter.exit();
          return false;
        }
        if (!this.adapter.allowed()) { this.stop('interrupted'); return false; }
        this.state = 'running';
        this.started = this.adapter.now();
        this.adapter.paint(demo ? 'demo' : 'black');
        this.timer = this.adapter.timeout(() => this.stop('completed'), config.seconds * 1000);
        this.frame = this.adapter.raf(time => this.tick(time, token));
        return true;
      } catch (error) {
        this.pendingEnter = false;
        if (this.token === token) this.stop('error', error);
        return false;
      }
    }
    tick(time, token) {
      if (this.state !== 'running' || token !== this.token) return;
      try {
        if (!this.adapter.allowed()) { this.stop('interrupted'); return; }
        const elapsed = Math.max(0, time - this.started);
        if (elapsed >= this.config.seconds * 1000) { this.stop('completed'); return; }
        if (this.previous !== null && time > this.previous) this.intervals.push(time - this.previous);
        this.previous = time;
        this.adapter.paint(this.demo ? 'demo' : phaseAt(elapsed, this.config.hz));
        this.frame = this.adapter.raf(next => this.tick(next, token));
      } catch (error) { this.stop('error', error); }
    }
    stop(reason, error) {
      if (this.state === 'idle') return false;
      const wasRunning = this.state === 'running';
      this.state = 'idle'; ++this.token;
      this.adapter.cancelRaf(this.frame); this.adapter.clearTimeout(this.timer);
      this.frame = null; this.timer = null;
      // Neutralize before attempting asynchronous fullscreen exit or updating the UI.
      this.adapter.paint('off');
      this.adapter.exit();
      this.adapter.finish({ reason, demo: this.demo, config: this.config,
        elapsed: wasRunning ? Math.max(0, this.adapter.now() - this.started) : 0,
        timing: summarize(this.intervals), error });
      return true;
    }
  }
  return { LIMITS, validate, phaseAt, summarize, Session };
});
