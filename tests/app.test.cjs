// Integration tests use a small DOM adapter, never a display or real flashes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Core = require('../src/core.js');
const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
function fixture({ demoOnly = false, denied = false } = {}) {
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const listeners = {}, attributes = {};
    const el = { id, listeners, attributes, hidden: ['stimulus','result','form-error','timing','measurement-note'].includes(id), dataset: {},
      lastChild: { textContent: '' }, value: id.startsWith('frequency') ? '2' : '15',
      addEventListener(type, callback) { (listeners[type] ||= []).push(callback); },
      dispatch(type, extra = {}) { for (const callback of listeners[type] || []) callback({ preventDefault() {}, ...extra }); },
      setAttribute(name, value) { attributes[name] = value; }, removeAttribute(name) { delete attributes[name]; },
      focus() { doc.activeElement = el; },
      get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); },
      get validity() { const n = this.valueAsNumber; return { valid: Number.isFinite(n) && (id === 'frequency' ? n >= 1 && n <= 20 && Number.isInteger(n * 2) : n >= 5 && n <= 120 && n % 5 === 0) }; }
    };
    elements.set(id, el); return el;
  }
  const doc = element('document'), win = element('window');
  Object.assign(doc, { getElementById: element, querySelector: () => element('brand'), fullscreenEnabled: true, fullscreenElement: null, hidden: false, hasFocus: () => true,
    exitFullscreen: async () => { doc.fullscreenElement = null; doc.dispatch('fullscreenchange'); } });
  element('stimulus').requestFullscreen = async () => { if (denied) throw new Error('denied'); doc.fullscreenElement = element('stimulus'); doc.dispatch('fullscreenchange'); };
  element('session-form').elements = ['frequency','duration','frequency-range','duration-range','demo-button','start-button'].map(element);
  let now = 100, raf, timer;
  vm.runInNewContext(source, { document: doc, window: win, location: { search: demoOnly ? '?demo=1' : '' }, URLSearchParams, Intl, StimulusCore: Core,
    performance: { now: () => now }, requestAnimationFrame: callback => { raf = callback; return 1; }, cancelAnimationFrame: () => { raf = null; },
    setTimeout: callback => { timer = callback; return 2; }, clearTimeout: () => { timer = null; } });
  return { element, doc, win,
    async launch(demo = true) { element(demo ? 'demo-button' : 'session-form').dispatch(demo ? 'click' : 'submit'); await Promise.resolve(); await Promise.resolve(); },
    advance(ms) { now += ms; raf?.(now); }, deadline() { timer?.(); }
  };
}
test('initial load has no stimulus and enables settings', () => {
  const f = fixture(); assert.equal(f.element('stimulus').hidden, true); assert.notEqual(f.element('frequency').disabled, true);
});
test('demo-only URL blocks live submission, including a synthetic submit', async () => {
  const f = fixture({ demoOnly: true }); await f.launch(false);
  assert.equal(f.element('start-button').disabled, true); assert.equal(f.doc.fullscreenElement, null);
  await f.launch(); assert.equal(f.element('stimulus').dataset.color, 'demo');
});
for (const reason of ['blur','hidden','fullscreen','click','escape']) {
  test(`browser event ${reason} neutralizes stimulus and restores settings`, async () => {
    const f = fixture(); await f.launch(); assert.equal(f.element('workspace').inert, true);
    if (reason === 'blur') f.win.dispatch('blur');
    if (reason === 'hidden') { f.doc.hidden = true; f.doc.dispatch('visibilitychange'); }
    if (reason === 'fullscreen') { f.doc.fullscreenElement = null; f.doc.dispatch('fullscreenchange'); }
    if (reason === 'click') f.element('stimulus').dispatch('pointerdown');
    if (reason === 'escape') f.doc.dispatch('keydown', { key: 'Escape' });
    assert.equal(f.element('stimulus').hidden, true); assert.equal(f.element('workspace').inert, false);
    assert.equal(f.element('frequency').disabled, false); assert.equal(f.element('result').hidden, false);
  });
}
test('denied fullscreen shows an error and no visible stimulus', async () => {
  const f = fixture({ denied: true }); await f.launch();
  assert.equal(f.element('stimulus').hidden, true); assert.equal(f.element('form-error').hidden, false);
  assert.equal(f.element('frequency').disabled, false);
});
test('invalid numeric input never requests fullscreen', async () => {
  const f = fixture(); f.element('frequency').value = '1.2'; await f.launch();
  assert.equal(f.doc.fullscreenElement, null); assert.equal(f.element('frequency').attributes['aria-invalid'], 'true');
});
test('slider updates numeric input and summary', () => {
  const f = fixture(); f.element('frequency-range').value = '10.5'; f.element('frequency-range').dispatch('input');
  assert.equal(f.element('frequency').value, '10.5'); assert.match(f.element('summary').textContent, /10,5/);
});
test('deadline restores UI and preserves chosen parameters', async () => {
  const f = fixture(); f.element('duration').value = '5'; await f.launch(); f.advance(5000);
  assert.equal(f.element('result-title').textContent, 'Сессия завершена');
  assert.equal(f.element('duration').value, '5'); assert.equal(f.element('stimulus').hidden, true);
});
