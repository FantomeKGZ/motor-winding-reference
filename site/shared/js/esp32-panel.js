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

    const settingsForm = document.createElement('div');
    settingsForm.className = 'cm-esp32-settings';

    const modeLabel = document.createElement('label');
    modeLabel.className = 'cm-esp32-field';
    const modeCaption = document.createElement('span');
    modeCaption.textContent = 'Режим';
    const mode = document.createElement('select');
    mode.dataset.esp32Mode = '';
    [
      ['off', 'Выключено'],
      ['mock', 'Тест'],
      ['live', 'ESP32'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      mode.appendChild(option);
    });
    modeLabel.append(modeCaption, mode);

    const urlLabel = document.createElement('label');
    urlLabel.className = 'cm-esp32-field';
    urlLabel.dataset.esp32UrlField = '';
    const urlCaption = document.createElement('span');
    urlCaption.textContent = 'Адрес ESP32';
    const url = document.createElement('input');
    url.type = 'url';
    url.inputMode = 'url';
    url.autocomplete = 'off';
    url.spellcheck = false;
    url.placeholder = 'http://192.168.1.50';
    url.dataset.esp32Url = '';
    urlLabel.append(urlCaption, url);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'cm-esp32-save';
    save.dataset.esp32Save = '';
    save.textContent = 'Сохранить';

    settingsForm.append(modeLabel, urlLabel, save);

    const hint = document.createElement('small');
    hint.className = 'cm-esp32-hint';
    hint.dataset.esp32Hint = '';

    const motor = document.createElement('div');
    motor.className = 'cm-esp32-motor';
    motor.dataset.esp32Motor = '';
    motor.hidden = true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-esp32-check';
    button.dataset.esp32Check = '';
    button.textContent = 'Проверить соединение';

    panel.append(title, status, address, settingsForm, hint, motor, button);
    sidebar.appendChild(panel);
    return panel;
  }

  function mixedContentWarning(settings) {
    return settings.mode === 'live'
      && window.location.protocol === 'https:'
      && /^http:\/\//i.test(settings.baseUrl || '');
  }

  function syncForm(settings = client.getSettings()) {
    const panel = ensurePanel();
    const mode = panel.querySelector('[data-esp32-mode]');
    const url = panel.querySelector('[data-esp32-url]');
    const urlField = panel.querySelector('[data-esp32-url-field]');
    const hint = panel.querySelector('[data-esp32-hint]');

    mode.value = settings.mode || 'off';
    url.value = settings.baseUrl || '';
    urlField.hidden = mode.value !== 'live';

    if (mixedContentWarning(settings)) {
      hint.textContent = 'HTTPS-страница может блокировать HTTP-запрос к ESP32. Для live-режима нужен совместимый способ доступа.';
      hint.dataset.state = 'warning';
    } else if (mode.value === 'mock') {
      hint.textContent = 'Тестовый режим использует локальный JSON и не обращается к ESP32.';
      hint.dataset.state = '';
    } else if (mode.value === 'live') {
      hint.textContent = 'Проверяется только чтение GET /api/context.';
      hint.dataset.state = '';
    } else {
      hint.textContent = 'Справочник работает автономно.';
      hint.dataset.state = '';
    }
  }

  function renderIdle() {
    const panel = ensurePanel();
    const settings = client.getSettings();
    const status = panel.querySelector('[data-esp32-status]');
    const text = panel.querySelector('[data-esp32-status-text]');
    const address = panel.querySelector('[data-esp32-address]');
    const motor = panel.querySelector('[data-esp32-motor]');
    const check = panel.querySelector('[data-esp32-check]');

    status.dataset.state = settings.mode === 'off' ? 'off' : 'idle';
    text.textContent = settings.mode === 'off' ? 'Не подключена' : 'Готово к проверке';
    address.textContent = settings.mode === 'mock'
      ? 'Режим: тестовые данные'
      : settings.mode === 'live'
        ? `Адрес: ${settings.baseUrl || 'не задан'}`
        : 'Режим подключения выключен';
    motor.hidden = true;
    check.disabled = settings.mode === 'off' || (settings.mode === 'live' && !settings.baseUrl);
    syncForm(settings);
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
    address.textContent = result.mode === 'mock'
      ? 'Источник: mock JSON'
      : `Адрес: ${result.sourceUrl.replace(/\/api\/context$/, '')}`;

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

  function saveSettings() {
    const panel = ensurePanel();
    const mode = panel.querySelector('[data-esp32-mode]').value;
    const baseUrl = panel.querySelector('[data-esp32-url]').value.trim();
    const saved = client.configure({ mode, baseUrl });
    syncForm(saved);
    renderIdle();

    if (mode === 'live' && baseUrl && !saved.baseUrl) {
      renderError(new Error('Некорректный адрес ESP32'));
      return;
    }

    document.dispatchEvent(new CustomEvent('coilmaster:esp32-settings-changed', { detail: saved }));
  }

  async function checkConnection() {
    const panel = ensurePanel();
    const button = panel.querySelector('[data-esp32-check]');
    const settings = client.getSettings();

    if (settings.mode === 'off') {
      renderIdle();
      return;
    }

    if (settings.mode === 'live' && !settings.baseUrl) {
      renderError(new Error('Сначала укажите адрес ESP32'));
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
  panel.querySelector('[data-esp32-mode]').addEventListener('change', (event) => {
    panel.querySelector('[data-esp32-url-field]').hidden = event.target.value !== 'live';
  });
  panel.querySelector('[data-esp32-save]').addEventListener('click', saveSettings);
  panel.querySelector('[data-esp32-url]').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveSettings();
    }
  });
  panel.querySelector('[data-esp32-check]').addEventListener('click', checkConnection);
  document.addEventListener('coilmaster:esp32-context', (event) => renderConnected(event.detail));
  renderIdle();
})();
