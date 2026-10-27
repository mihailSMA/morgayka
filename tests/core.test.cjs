const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate, phaseAt, summarize, Session } = require('../src/core.js');

function fixture(enter = () => Promise.resolve()) {
  let now = 100, allowed = true, frame, timer, lastColor;
  const colors = [], reports = [];
  const adapter = {
    now: () => now, enter, allowed: () => allowed,
    raf: callback => { frame = callback; return 1; }, cancelRaf: () => { frame = null; },
    timeout: callback => { timer = callback; return 2; }, clearTimeout: () => { timer = null; },
    paint: color => { lastColor = color; colors.push(color); }, exit: () => {}, finish: report => reports.push(report)
  };
  return { session: new Session(adapter), adapter, reports, colors,
    advance(ms) { now = 100 + ms; const callback = frame; frame = null; callback?.(now); },
    timeout() { timer?.(); }, disallow() { allowed = false; },
    get color() { return lastColor; }, get frame() { return frame; }, get timer() { return timer; }
  };
}
const config = { hz: 2, seconds: 5 };
test('accepts boundaries; rejects empty, nonfinite, out-of-range and off-step values', () => {
  assert.deepEqual(validate(1, 5), { hz: 1, seconds: 5 }); validate(20, 120); validate(1.5, 15);
  for (const hz of [NaN, Infinity, 0, 20.5, 1.2]) assert.throws(() => validate(hz, 5), RangeError);
  for (const seconds of [NaN, Infinity, 0, 121, 6]) assert.throws(() => validate(2, seconds), RangeError);
});
test('phase boundaries represent full cycles with equal halves', () => {
  for (const [time, color] of [[0,'black'],[249.99,'black'],[250,'red'],[499.99,'red'],[500,'black']]) assert.equal(phaseAt(time, 2), color);
  assert.equal(phaseAt(25, 20), 'red'); assert.equal(phaseAt(50, 20), 'black');
});
test('delayed frames jump to current phase without replaying missed colors', async () => {
  const f = fixture(); await f.session.start(config); f.advance(1280);
  assert.deepEqual(f.colors, ['black', 'red']);
});
test('frame deadline stops before painting another phase and cancels callbacks', async () => {
  const f = fixture(); await f.session.start(config); f.advance(5000);
  assert.equal(f.color, 'off'); assert.equal(f.reports[0].reason, 'completed'); assert.equal(f.frame, null); assert.equal(f.timer, null);
});
test('independent deadline ends a session when frames are not arriving', async () => {
  const f = fixture(); await f.session.start(config); f.timeout();
  assert.equal(f.session.state, 'idle'); assert.equal(f.color, 'off');
});
test('demo never paints a live color, even after delays', async () => {
  const f = fixture(); await f.session.start(config, true);
  f.advance(16); f.advance(260); f.advance(1280); f.session.stop('click');
  assert.deepEqual(f.colors, ['demo', 'demo', 'demo', 'demo', 'off']);
});
test('stop is idempotent and ignores stale callbacks', async () => {
  const f = fixture(); await f.session.start(config); const stale = f.frame;
  assert.equal(f.session.stop('escape'), true); assert.equal(f.session.stop('click'), false);
  stale(300); assert.equal(f.reports.length, 1); assert.equal(f.color, 'off');
});
test('focus/fullscreen guard stops session without another flash', async () => {
  const f = fixture(); await f.session.start(config); f.disallow(); f.advance(260);
  assert.deepEqual(f.colors, ['black', 'off']); assert.equal(f.reports[0].reason, 'interrupted');
});
test('failed fullscreen produces an error without starting a frame loop', async () => {
  const f = fixture(() => Promise.reject(new Error('denied'))); assert.equal(await f.session.start(config), false);
  assert.deepEqual(f.colors, ['off']); assert.equal(f.reports[0].reason, 'error'); assert.equal(f.frame, null);
});
test('cancel during fullscreen request cannot resurrect a stopped session', async () => {
  let grant; const f = fixture(() => new Promise(resolve => { grant = resolve; }));
  const starting = f.session.start(config); f.session.stop('blur'); grant();
  assert.equal(await starting, false); assert.equal(f.session.state, 'idle'); assert.deepEqual(f.colors, ['off']);
});
test('duplicate launch does not alter active configuration', async () => {
  const f = fixture(); await f.session.start(config);
  assert.equal(await f.session.start({ hz: 20, seconds: 120 }), false);
  f.advance(250); assert.equal(f.color, 'red');
});
test('paint failure neutralizes session and reports error', async () => {
  const f = fixture(); const paint = f.adapter.paint;
  f.adapter.paint = color => { if (color === 'red') throw new Error('render'); paint(color); };
  await f.session.start(config); f.advance(250); assert.equal(f.color, 'off'); assert.equal(f.reports[0].reason, 'error');
});
test('frame statistics use measured intervals, not requested stimulus frequency', async () => {
  const f = fixture(); await f.session.start(config, true); f.advance(16); f.advance(32); f.advance(48); f.advance(96); f.session.stop('click');
  assert.deepEqual(f.reports[0].timing, { samples: 3, median: 16, max: 48, late: 1 });
  assert.equal(summarize([]), null); assert.equal(summarize([10,20]).median, 15);
});

test('new launch is blocked while a cancelled fullscreen request is unresolved', async () => {
  let grant; const f = fixture(() => new Promise(resolve => { grant = resolve; }));
  const first = f.session.start(config); f.session.stop('blur');
  assert.equal(await f.session.start(config), false);
  grant(); await first; assert.equal(f.session.pendingEnter, false);
});
