(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const surface = $('stimulus');
  const workspace = $('workspace');
  const form = $('session-form');
  const fields = [$('frequency'), $('duration')];
  const demoOnly = new URLSearchParams(location.search).get('demo') === '1';
  let exiting = false;
  const number = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
  const reasons = { completed: 'Сессия завершена', click: 'Остановлено щелчком', escape: 'Остановлено клавишей Esc', blur: 'Остановлено: потеря фокуса', hidden: 'Остановлено: вкладка скрыта', fullscreen: 'Остановлено: выход из полного экрана', interrupted: 'Запуск или сессия прерваны', error: 'Не удалось выполнить сессию' };
  function showError(message) { $('form-error').textContent = message; $('form-error').hidden = !message; }
  function busy(value) {
    for (const control of form.elements) control.disabled = value;
    if (demoOnly) $('start-button').disabled = true;
    document.querySelector('.brand').href = 'index.html?demo=1';
    $('status').lastChild.textContent = value ? ' Запрос полного экрана…' : (demoOnly ? ' Только демонстрация' : 'Готово к настройке');
  }
  function exit() {
    if (!document.fullscreenElement) return;
    exiting = true;
    Promise.resolve(document.exitFullscreen()).catch(() => {
      showError('Сессия остановлена. Браузер не вышел из полного экрана; нажмите Esc.');
    }).finally(() => { exiting = false; });
  }
  const session = new StimulusCore.Session({
    now: () => performance.now(),
    raf: callback => requestAnimationFrame(callback), cancelRaf: handle => cancelAnimationFrame(handle),
    timeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle),
    enter: () => {
      if (exiting || document.fullscreenElement) throw new Error('fullscreen-busy');
      if (!document.fullscreenEnabled || !surface.requestFullscreen) throw new Error('fullscreen-unavailable');
      surface.dataset.color = 'black'; surface.hidden = false;
      return surface.requestFullscreen();
    },
    allowed: () => document.fullscreenElement === surface && !document.hidden && document.hasFocus(),
    paint: color => {
      surface.hidden = color === 'off';
      surface.dataset.color = color === 'off' ? 'black' : color;
      workspace.inert = color !== 'off';
    },
    exit,
    finish: result => {
      busy(false);
      $('result').hidden = false;
      $('result-label').textContent = result.demo ? 'ДЕМОНСТРАЦИЯ БЕЗ ВСПЫШЕК' : 'ПОСЛЕДНЯЯ СЕССИЯ';
      $('result-title').textContent = reasons[result.reason] || 'Сессия остановлена';
      $('result-time').textContent = number(result.elapsed / 1000) + ' сек';
      $('result-description').textContent = result.demo
        ? 'Неподвижный нейтральный фон. Мигание не включалось.'
        : `Задано: ${number(result.config.hz)} Гц, ${result.config.seconds} сек. Настройки сохранены для следующего запуска.`;
      $('timing').hidden = !result.timing;
      $('measurement-note').hidden = !result.timing;
      if (result.timing) {
        $('median').textContent = number(result.timing.median) + ' мс';
        $('max').textContent = number(result.timing.max) + ' мс';
        $('late').textContent = result.timing.late + ' / ' + result.timing.samples;
      }
      if (result.reason === 'error') {
        showError(result.error?.message === 'fullscreen-busy'
          ? 'Полноэкранный режим ещё закрывается. Подождите и повторите запуск.'
          : 'Запуск не выполнен или произошла ошибка. Проверьте разрешение полного экрана и повторите запуск.');
      }
      // Wait for the browser's fullscreen transition before restoring keyboard focus.
      if (!document.fullscreenElement) (result.demo ? $('demo-button') : $('start-button')).focus({ preventScroll: true });
    }
  });
  function updateSummary() {
    $('summary').textContent = `${number(fields[0].valueAsNumber)} Гц · ${number(fields[1].valueAsNumber)} сек · Полный экран`;
  }
  for (const [field, range] of [[fields[0], $('frequency-range')], [fields[1], $('duration-range')]]) {
    field.addEventListener('input', () => { if (field.validity.valid && field.value !== '') range.value = field.value; field.removeAttribute('aria-invalid'); showError(''); updateSummary(); });
    range.addEventListener('input', () => { field.value = range.value; field.removeAttribute('aria-invalid'); showError(''); updateSummary(); });
  }
  async function launch(demo) {
    if (session.state !== 'idle' || (demoOnly && !demo)) return;
    if (session.pendingEnter) { showError('Браузер ещё обрабатывает предыдущий запрос полного экрана. Подождите и повторите запуск.'); return; }
    showError('');
    let config;
    try { config = StimulusCore.validate(fields[0].valueAsNumber, fields[1].valueAsNumber); }
    catch (error) {
      const invalid = fields.find(field => !field.validity.valid || field.value === '');
      invalid?.setAttribute('aria-invalid', 'true'); invalid?.focus(); showError(error.message); return;
    }
    busy(true);
    await session.start(config, demo);
  }
  form.addEventListener('submit', event => { event.preventDefault(); launch(false); });
  $('demo-button').addEventListener('click', () => launch(true));
  surface.addEventListener('pointerdown', () => session.stop('click'));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') session.stop('escape'); });
  window.addEventListener('blur', () => session.stop('blur'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) session.stop('hidden'); });
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement !== surface) {
      session.stop('fullscreen');
      if (!document.fullscreenElement && !surface.hidden) surface.hidden = true;
      if (!document.fullscreenElement) $('demo-button').focus({ preventScroll: true });
    }
  });
  window.addEventListener('pagehide', () => session.stop('hidden'));
  if (demoOnly) {
    $('start-button').disabled = true;
    document.querySelector('.brand').href = 'index.html?demo=1';
    $('status').lastChild.textContent = ' Только демонстрация';
    $('demo-button').focus({ preventScroll: true });
  }
})();
