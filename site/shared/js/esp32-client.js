(() => {
  'use strict';

  const SETTINGS_KEY = 'coilmaster-esp32-client-settings';
  const DEFAULT_TIMEOUT_MS = 3500;
  const MOCK_URL = '../shared/data/esp32-mock.json';

  function readStoredSettings() {
    try {
      const value = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function writeStoredSettings(value) {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
    } catch {
      // Connection settings are optional; the handbook must remain usable.
    }
  }

  function sanitizeBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, window.location.href);
      if (!/^https?:$/i.test(url.protocol)) return '';
      url.hash = '';
      return url.href.replace(/\/$/, '');
    } catch {
      return '';
    }
  }

  function resolveSettings() {
    const query = new URLSearchParams(window.location.search);
    const stored = readStoredSettings();
    const queryMode = query.get('esp32');
    const queryUrl = query.get('esp32url');

    let mode = queryMode === 'live' ? 'live' : queryMode === 'mock' ? 'mock' : stored.mode;
    if (!mode) mode = query.get('esp32test') === '1' ? 'mock' : 'off';

    const baseUrl = sanitizeBaseUrl(queryUrl || stored.baseUrl || '');
    return {
      mode,
      baseUrl,
      timeoutMs: Number.isFinite(Number(stored.timeoutMs)) ? Number(stored.timeoutMs) : DEFAULT_TIMEOUT_MS,
    };
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('ESP32 returned an invalid JSON object');
    const motor = payload.motor;
    if (motor != null && typeof motor !== 'object') throw new Error('ESP32 field motor must be an object');
    return payload;
  }

  async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return validatePayload(await response.json());
    } finally {
      window.clearTimeout(timer);
    }
  }

  function liveContextUrl(settings) {
    if (!settings.baseUrl) throw new Error('ESP32 address is not configured');
    return `${settings.baseUrl}/api/context`;
  }

  async function getContext(options = {}) {
    const settings = { ...resolveSettings(), ...options };
    let payload;
    let sourceUrl;

    if (settings.mode === 'mock') {
      sourceUrl = MOCK_URL;
      payload = await fetchJson(sourceUrl, settings.timeoutMs || DEFAULT_TIMEOUT_MS);
    } else if (settings.mode === 'live') {
      sourceUrl = liveContextUrl(settings);
      payload = await fetchJson(sourceUrl, settings.timeoutMs || DEFAULT_TIMEOUT_MS);
    } else {
      throw new Error('ESP32 client is disabled');
    }

    const result = {
      mode: settings.mode,
      sourceUrl,
      receivedAt: new Date().toISOString(),
      payload,
    };

    window.CoilMasterEsp32Context = result;
    document.dispatchEvent(new CustomEvent('coilmaster:esp32-context', { detail: result }));
    return result;
  }

  function configure(partial = {}) {
    const current = resolveSettings();
    const next = {
      mode: partial.mode === 'live' || partial.mode === 'mock' || partial.mode === 'off' ? partial.mode : current.mode,
      baseUrl: partial.baseUrl != null ? sanitizeBaseUrl(partial.baseUrl) : current.baseUrl,
      timeoutMs: Number.isFinite(Number(partial.timeoutMs)) ? Number(partial.timeoutMs) : current.timeoutMs,
    };
    writeStoredSettings(next);
    return next;
  }

  window.CoilMasterEsp32Client = Object.freeze({
    getSettings: resolveSettings,
    configure,
    getContext,
  });

  document.dispatchEvent(new CustomEvent('coilmaster:esp32-client-ready', {
    detail: { settings: resolveSettings() },
  }));
})();
