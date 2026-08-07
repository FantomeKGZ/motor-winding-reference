(() => {
  'use strict';

  function requirePart(name, value) {
    if (!value) throw new Error(`${name} is not ready`);
    return value;
  }

  function normalizeMotorId(value) {
    const id = String(value || '').trim();
    if (!id) throw new Error('motor_id is required');
    return id;
  }

  function candidateBySchemeId(candidates, schemeId) {
    if (!schemeId) return null;
    return (candidates || []).find((item) => (item.scheme_id || item.id) === schemeId) || null;
  }

  function connectionById(scheme, connectionId) {
    if (!scheme || !connectionId) return null;
    const options = scheme.connection_options || scheme.connectionOptions || [];
    return options.find((item) => item.connection_id === connectionId) || null;
  }

  function unwrapBindingResponse(payload) {
    if (!payload || typeof payload !== 'object') return { binding: null, revision: null };
    const binding = payload.winding_reference || payload.binding || null;
    const revision = Number.isInteger(payload.revision) ? payload.revision : null;
    return { binding, revision };
  }

  async function mount(container, options = {}) {
    if (!container) throw new Error('container is required');

    const widget = requirePart('Motor scheme widget', window.CoilMasterMotorSchemeWidget);
    const bindingClient = requirePart('Motor binding client', window.CoilMasterMotorBindingClient);
    const catalogClient = window.CoilMasterSchemeCatalogClient || null;
    const motorId = normalizeMotorId(options.motorId || options.motor?.id || options.motor?.motor_id);
    const state = {
      motorId,
      motor: options.motor || {},
      candidates: options.candidates || [],
      binding: options.binding || null,
      revision: Number.isInteger(options.revision) ? options.revision : null,
      scheme: null,
      connection: null,
      busy: false,
      lastError: null,
      catalogError: null,
    };

    function resolveCatalogEntities() {
      state.scheme = candidateBySchemeId(state.candidates, state.binding?.scheme_id);
      state.connection = connectionById(state.scheme, state.binding?.connection_id);
    }

    function notify(name, detail = {}) {
      const eventDetail = { ...detail, motorId: state.motorId, state: { ...state } };
      document.dispatchEvent(new CustomEvent(name, { detail: eventDetail }));
      options.onStateChange?.(eventDetail);
    }

    function render(message = '') {
      resolveCatalogEntities();
      container.dataset.cmMotorSchemeState = state.busy ? 'busy' : state.lastError ? 'error' : 'ready';
      widget.bindPicker(container, {
        motor: state.motor,
        candidates: state.candidates,
        binding: state.binding || {},
        scheme: state.scheme,
        connection: state.connection,
        maxConnectionPreviews: options.maxConnectionPreviews || 2,
        onBindingChange: saveSelection,
        onShowConnections: options.onShowConnections,
        onRemove: remove,
      });

      const statusMessage = state.lastError?.message || message || state.catalogError?.message || '';
      if (statusMessage) {
        let status = container.querySelector('.cm-msw-controller-status');
        if (!status) {
          status = document.createElement('div');
          status.className = 'cm-msw-controller-status';
          status.setAttribute('role', 'status');
          container.append(status);
        }
        status.textContent = statusMessage;
      }
    }

    async function loadCandidates() {
      if (state.candidates.length || !catalogClient?.findCandidates) return state.candidates;
      state.catalogError = null;
      try {
        state.candidates = await catalogClient.findCandidates(state.motor, options.catalogOptions || {});
        notify('coilmaster:motor-scheme-candidates-loaded', { candidates: state.candidates });
      } catch (error) {
        state.catalogError = error;
        notify('coilmaster:motor-scheme-catalog-error', { error });
      }
      return state.candidates;
    }

    async function refresh() {
      state.busy = true;
      state.lastError = null;
      render('Загрузка привязки…');
      try {
        await loadCandidates();
        const response = await bindingClient.getBinding(state.motorId);
        const result = unwrapBindingResponse(response);
        state.binding = result.binding;
        if (result.revision != null) state.revision = result.revision;
        notify('coilmaster:motor-scheme-refreshed', { response });
      } catch (error) {
        if (error?.status === 404) {
          state.binding = null;
        } else {
          state.lastError = error;
          notify('coilmaster:motor-scheme-error', { operation: 'refresh', error });
        }
      } finally {
        state.busy = false;
        render();
      }
      return state;
    }

    async function saveSelection(selection) {
      if (!selection?.binding || state.busy) return;
      state.busy = true;
      state.lastError = null;
      render('Сохранение привязки…');
      try {
        const response = await bindingClient.saveBinding(state.motorId, selection.binding, state.revision);
        const result = unwrapBindingResponse(response);
        state.binding = result.binding || selection.binding;
        if (result.revision != null) state.revision = result.revision;
        notify('coilmaster:motor-scheme-saved', { response, selection });
      } catch (error) {
        state.lastError = error;
        if (bindingClient.isRevisionConflict(error)) {
          notify('coilmaster:motor-scheme-conflict', { operation: 'save', error });
          options.onConflict?.({ operation: 'save', error, refresh });
        } else {
          notify('coilmaster:motor-scheme-error', { operation: 'save', error });
        }
      } finally {
        state.busy = false;
        render();
      }
    }

    async function remove() {
      if (state.busy || !state.binding) return;
      if (options.confirmRemove !== false) {
        const confirmed = window.confirm('Удалить привязку схемы от этого двигателя? Справочник и изображения удалены не будут.');
        if (!confirmed) return;
      }

      state.busy = true;
      state.lastError = null;
      render('Удаление привязки…');
      try {
        const response = await bindingClient.removeBinding(state.motorId, state.revision);
        const result = unwrapBindingResponse(response);
        state.binding = null;
        if (result.revision != null) state.revision = result.revision;
        notify('coilmaster:motor-scheme-removed', { response });
      } catch (error) {
        state.lastError = error;
        if (bindingClient.isRevisionConflict(error)) {
          notify('coilmaster:motor-scheme-conflict', { operation: 'remove', error });
          options.onConflict?.({ operation: 'remove', error, refresh });
        } else {
          notify('coilmaster:motor-scheme-error', { operation: 'remove', error });
        }
      } finally {
        state.busy = false;
        render();
      }
    }

    function setCandidates(candidates) {
      state.candidates = Array.isArray(candidates) ? candidates : [];
      state.catalogError = null;
      render();
    }

    async function setMotor(motor, reloadCandidates = true) {
      state.motor = motor || {};
      if (reloadCandidates) {
        state.candidates = [];
        await loadCandidates();
      }
      render();
    }

    render();
    await loadCandidates();
    if (options.autoLoad !== false && !state.binding) await refresh();
    else render();

    return Object.freeze({
      getState: () => ({ ...state }),
      refresh,
      remove,
      loadCandidates,
      setCandidates,
      setMotor,
      render,
    });
  }

  window.CoilMasterMotorSchemeController = Object.freeze({ mount });
})();
