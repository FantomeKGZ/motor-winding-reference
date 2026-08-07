(() => {
  'use strict';

  const DEMO_MOTOR = {
    id: 'demo-motor-36-3000',
    model: 'Тестовый двигатель 36/3000',
    slots: 36,
    rpm: 3000,
    poles: 2,
    q: 6,
    winding_type: 'two_layer',
    parallel_branches: 2,
    winding_pitch: '15',
    revision: 1,
  };

  const state = {
    motor: { ...DEMO_MOTOR },
    candidates: [],
    binding: null,
    scheme: null,
    connection: null,
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function resolveEntities() {
    state.scheme = state.binding?.scheme_id
      ? state.candidates.find((item) => item.scheme_id === state.binding.scheme_id) || null
      : null;
    state.connection = state.scheme && state.binding?.connection_id
      ? (state.scheme.connection_options || []).find((item) => item.connection_id === state.binding.connection_id) || null
      : null;
  }

  function renderMotorSummary(container) {
    container.replaceChildren();
    const title = el('h2', '', state.motor.model);
    const grid = el('div', 'cm-demo-motor-grid');
    [
      ['Пазы', state.motor.slots],
      ['Обороты', state.motor.rpm],
      ['2p', state.motor.poles],
      ['q', state.motor.q],
      ['Тип', state.motor.winding_type],
      ['a', state.motor.parallel_branches],
      ['y', state.motor.winding_pitch],
    ].forEach(([label, value]) => {
      const item = el('div', 'cm-demo-field');
      item.append(el('span', '', label), el('strong', '', String(value ?? '—')));
      grid.append(item);
    });
    container.append(title, grid);
  }

  function renderBindingJson(container) {
    container.textContent = JSON.stringify({ winding_reference: state.binding }, null, 2);
  }

  function renderWidget(container, jsonContainer, status) {
    resolveEntities();
    const widget = window.CoilMasterMotorSchemeWidget;
    if (!widget) {
      status.textContent = 'Виджет карточки ещё не загружен.';
      return;
    }

    widget.bindPicker(container, {
      motor: state.motor,
      candidates: state.candidates,
      binding: state.binding || {},
      scheme: state.scheme,
      connection: state.connection,
      maxConnectionPreviews: 2,
      onBindingChange(selection) {
        state.binding = {
          ...selection.binding,
          version: 1,
          binding_source: 'user',
          verification: 'confirmed',
        };
        status.textContent = 'Привязка сохранена только в памяти браузера. ESP32 не используется.';
        renderWidget(container, jsonContainer, status);
      },
      onRemove() {
        state.binding = null;
        status.textContent = 'Тестовая привязка удалена. ESP32 не используется.';
        renderWidget(container, jsonContainer, status);
      },
      onShowConnections({ scheme }) {
        window.CoilMasterSchemePicker?.open({
          motor: state.motor,
          candidates: [scheme],
          currentBinding: state.binding || {},
          onSelect(selection) {
            state.binding = {
              ...selection.binding,
              version: 1,
              binding_source: 'user',
              verification: 'confirmed',
            };
            status.textContent = 'Выбран вариант подключения в тестовом режиме.';
            renderWidget(container, jsonContainer, status);
          },
        });
      },
    });

    renderBindingJson(jsonContainer);
  }

  async function init() {
    const root = document.querySelector('[data-motor-card-demo]');
    if (!root) return;

    const summary = root.querySelector('[data-demo-motor-summary]');
    const widgetHost = root.querySelector('[data-demo-widget]');
    const jsonHost = root.querySelector('[data-demo-binding-json]');
    const status = root.querySelector('[data-demo-status]');
    const count = root.querySelector('[data-demo-candidate-count]');
    const reload = root.querySelector('[data-demo-reload]');

    renderMotorSummary(summary);

    async function loadCandidates() {
      status.textContent = 'Загрузка каталога схем…';
      const client = window.CoilMasterSchemeCatalogClient;
      if (!client) {
        status.textContent = 'Клиент каталога не загружен.';
        return;
      }
      try {
        state.candidates = await client.findCandidates(state.motor);
        count.textContent = String(state.candidates.length);
        const runtime = Boolean(window.CoilMasterSchemeCatalog?.runtime);
        const source = runtime
          ? 'Готовый JSON-каталог не найден, поэтому тест безопасно разобрал только нужную старую страницу.'
          : 'Используется готовый JSON-каталог.';
        status.textContent = state.candidates.length
          ? `${source} Можно выбрать схему и подключение.`
          : `${source} Для тестового двигателя подходящие схемы не найдены.`;
        renderWidget(widgetHost, jsonHost, status);
      } catch (error) {
        status.textContent = `Ошибка каталога: ${error.message}`;
      }
    }

    reload?.addEventListener('click', () => {
      state.binding = null;
      loadCandidates();
    });

    await loadCandidates();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();