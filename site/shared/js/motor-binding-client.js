(() => {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 4000;

  function getSettings() {
    const client = window.CoilMasterEsp32Client;
    if (!client?.getSettings) throw new Error('ESP32 client is not ready');
    const settings = client.getSettings();
    if (settings.mode !== 'live') throw new Error('Motor binding writes require live ESP32 mode');
    if (!settings.baseUrl) throw new Error('ESP32 address is not configured');
    return settings;
  }

  function motorIdPath(motorId) {
    const value = String(motorId || '').trim();
    if (!value) throw new Error('motor_id is required');
    return encodeURIComponent(value);
  }

  async function request(path, options = {}) {
    const settings = getSettings();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), Number(settings.timeoutMs) || DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(`${settings.baseUrl}${path}`, {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        cache: 'no-store',
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }

      if (!response.ok) {
        const error = new Error(payload?.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function normalizeBinding(binding) {
    if (!binding || typeof binding !== 'object') throw new Error('Binding must be an object');
    const schemeId = String(binding.scheme_id || '').trim();
    const connectionId = binding.connection_id == null ? null : String(binding.connection_id).trim();
    if (!/^CM-SCH-[A-Z0-9]+$/i.test(schemeId)) throw new Error('Invalid scheme_id');
    if (connectionId && !/^CM-CON-[A-Z0-9]+$/i.test(connectionId)) throw new Error('Invalid connection_id');
    return {
      version: Number(binding.version) || 1,
      scheme_id: schemeId,
      connection_id: connectionId || null,
      catalog_version: Number(binding.catalog_version) || 3,
      binding_source: binding.binding_source || 'user',
      verification: binding.verification || 'confirmed',
    };
  }

  async function getBinding(motorId) {
    return request(`/api/motors/${motorIdPath(motorId)}/winding-reference`);
  }

  async function saveBinding(motorId, binding, expectedRevision = null) {
    const body = { winding_reference: normalizeBinding(binding) };
    if (Number.isInteger(expectedRevision)) body.expected_revision = expectedRevision;
    const result = await request(`/api/motors/${motorIdPath(motorId)}/winding-reference`, {
      method: 'PUT',
      body,
    });
    document.dispatchEvent(new CustomEvent('coilmaster:motor-binding-saved', { detail: result }));
    return result;
  }

  async function removeBinding(motorId, expectedRevision = null) {
    const body = Number.isInteger(expectedRevision) ? { expected_revision: expectedRevision } : null;
    const result = await request(`/api/motors/${motorIdPath(motorId)}/winding-reference`, {
      method: 'DELETE',
      body,
    });
    document.dispatchEvent(new CustomEvent('coilmaster:motor-binding-removed', { detail: result }));
    return result;
  }

  function isRevisionConflict(error) {
    return error?.status === 409 || error?.payload?.error === 'revision_conflict';
  }

  window.CoilMasterMotorBindingClient = Object.freeze({
    getBinding,
    saveBinding,
    removeBinding,
    normalizeBinding,
    isRevisionConflict,
  });
})();
