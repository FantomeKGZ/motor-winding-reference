(() => {
  'use strict';

  const client = window.CoilMasterEsp32Client;
  const sidebar = document.querySelector('[data-sidebar]');
  if (!client || !sidebar) return;

  function valueOrDash(value) {
    return value == null || value === '' ? '—' : String(value);
  }

  function ensurePanel() {
    let panel = sidebar.querySelector('[data-esp32-panel]');
    if (panel) return panel;

    panel = document.createElement('section');
    panel.className = 'cm-esp32-panel';
    panel.dataset.esp32Panel = '';

    const title = document.createElement('div');
    title.className = 'cm-nav-title';
    title.textContent = 'ESP32';

    const status = document.createElement('div');
    status.className = 'cm-esp32-status';
    status.dataset.esp32Status = '';

    const dot = document.createElement('span');
    dot.className = 'cm-esp32-status-dot';
    dot.setAttribute('aria-hidden', 'true');

    const statusText = document.createElement('strong');
    statusText.dataset.esp32StatusText = '';

    status.append(dot, statusText);

    const address = document.createElement('small');
    address.className = 'cm-esp32-address';
    address.dataset.esp32Address = '';

    const motor = document.createElement('div');
    motor.className = 'cm-esp32-motor';
    motor.dataset.esp32Motor = '';
    motor.hidden = true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-esp32-check';
    button.dataset.esp32Check = '';
    button.textContent = 'Проверить соединение';

    panel.append(title, status, address, motor, button);
    sidebar.appendChild(panel);
    return panel;
  }

  function renderIdle() {
    const panel = ensurePanel();
    const settings = client.getSettings();
    const status = panel.querySelector('[data-esp32-status]');
    const text = panel.querySelector('[data-esp32-status-text]');
    const address = panel.querySelector('[data-esp32-address]');
    const motor = panel.querySelector('[data-esp32-motor]');

    status.dataset.state = settings.mode === 'off' ? 'off' : 'idle';
    text.textContent = settings.mode === 'off' ? 'Не подключена' : 'Готово к проверке';
    address.textContent = settings.mode === 'mock'
      ? 'Режим: тестовые данные'
      : settings.mode === 'live'
        ? `Адрес: ${settings.baseUrl || 'не задан'}`
        : 'Режим подключения выключен';
    motor.hidden = true;
  }

  function renderConnected(result) {
    const panel = ensurePanel();
    const payload = result?.payload || {};
    const data = payload.motor || {};
    const status = panel.querySelector('[data-esp32-status]');
    const text = panel.querySelector('[data-esp32-status-text]');
    const address = panel.querySelector('[data-esp32-address]');
    const motor = panel.querySelector('[data-esp32-motor]');

    status.dataset.state = 'connected';
    text.textContent = result.mode === 'mock' ? 'Тест подключён' : 'Подключена';
    address.textContent = result.mode === 'mock' ? 'Источник: mock JSON' : `Адрес: ${result.sourceUrl.replace(/\/api\/context$/, '')}`;

    motor.replaceChildren();
    const model = document.createElement('strong');
    model.textContent = valueOrDash(data.model || payload.project_id || 'Текущий двигатель');
    const details = document.createElement('small');
    details.textContent = `${valueOrDash(data.slots)} пазов · ${valueOrDash(data.rpm)} об/мин · ${valueOrDash(data.phases)} фазы`;
    motor.append(model, details);
    motor.hidden = false;
  }

  function renderError(error) {
    const panel = ensurePanel();
    const status = panel.querySelector('[data-esp32-status]');
    const text = panel.querySelector('[data-esp32-status-text]');
    const motor = panel.querySelector('[data-esp32-motor]');
    status.dataset.state = 'error';
    text.textContent = 'Нет связи';
    motor.hidden = true;
    panel.querySelector('[data-esp32-address]').textContent = error?.message || 'ESP32 недоступна';
  }

  async function checkConnection() {
    const panel = ensurePanel();
    const button = panel.querySelector('[data-esp32-check]');
    const settings = client.getSettings();

    if (settings.mode === 'off') {
      renderIdle();
      return;
    }

    button.disabled = true;
    button.textContent = 'Проверка…';
    try {
      const result = await client.getContext();
      renderConnected(result);
    } catch (error) {
      renderError(error);
    } finally {
      button.disabled = false;
      button.textContent = 'Проверить соединение';
    }
  }

  const panel = ensurePanel();
  panel.querySelector('[data-esp32-check]').addEventListener('click', checkConnection);
  document.addEventListener('coilmaster:esp32-context', (event) => renderConnected(event.detail));
  renderIdle();
})();
