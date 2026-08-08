(() => {
  'use strict';

  const state = { candidates: [], motor: {}, selectedScheme: null, selectedConnection: null };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function close() {
    document.querySelector('[data-cm-scheme-picker]')?.remove();
  }

  function connectionLabel(item) {
    const type = item?.type || item?.kind || '';
    let label = '';
    if (type === 'star') label = 'Звезда';
    else if (type === 'delta') label = 'Треугольник';
    else if (type === 'star_delta') label = 'Звезда / треугольник';
    else if (type === 'double_star') label = 'Двойная звезда';
    else if (type === 'dahlander') label = 'Даландер';
    else if (type === 'single_phase_winding') label = 'Соединение однофазной обмотки';
    else if (type === 'single_phase_supply') label = 'Подключение однофазного двигателя к сети';
    else if (type === 'two_speed_winding') label = 'Соединение двухскоростной обмотки';
    else if (type === 'two_speed_supply') label = 'Подключение двухскоростного двигателя к сети';
    else if (type === 'three_speed_winding') label = 'Соединение трёхскоростной обмотки';
    else if (type === 'three_speed_supply') label = 'Подключение трёхскоростного двигателя к сети';
    else label = item?.title || item?.page || 'Схема подключения';

    const branches = item?.parallel_branches || item?.parallelBranches || [];
    if (branches.length) label += ` · a=${branches.join('/')}`;
    if (item?.phase_connection) label += ` · ${item.phase_connection}`;
    return label;
  }

  function imageUrl(path) {
    if (!path) return '';
    const current = window.location.pathname.includes('/mobile/') ? 'mobile' : 'desktop';
    const root = current === 'mobile'
      ? '../../sourse/mobile/Справочник от 09.12.2024 для мобильных устройств HTML/'
      : '../../sourse/desktop/Справочник от 09.12.2024 HTML/';
    return new URL(root + path, window.location.href).href;
  }

  function normalizeCandidate(input) {
    const connectionOptions = input.connection_options || input.connectionOptions || [];
    return {
      scheme_id: input.scheme_id || input.id || `${input.target || ''}|${input.image || ''}`,
      legacy_page: input.legacy_page || input.target || '',
      image: input.image || '',
      description: input.description || input.section || 'Схема укладки',
      pitch: input.pitch || null,
      parallel_branches: input.parallel_branches || input.parallelBranches || [],
      winding_types: input.winding_types || input.windingTypes || [],
      connection_options: connectionOptions,
    };
  }

  function buildBinding() {
    if (!state.selectedScheme) return null;
    return {
      scheme_id: state.selectedScheme.scheme_id,
      connection_id: state.selectedConnection?.connection_id || null,
      catalog_version: 3,
    };
  }

  function renderConnections(container) {
    container.replaceChildren();
    const scheme = state.selectedScheme;
    if (!scheme) return;

    const options = scheme.connection_options || [];
    const title = el('div', 'cm-picker-subtitle', `Схемы подключения: ${options.length}`);
    container.append(title);

    if (!options.length) {
      container.append(el('p', 'cm-picker-empty', 'Для этой укладки отдельная схема подключения в каталоге не найдена.'));
      return;
    }

    const motorBranch = Number(state.motor?.parallel_branches);
    if (Number.isFinite(motorBranch) && options.some((item) => (item.parallel_branches || []).length)) {
      const matching = options.filter((item) => !(item.parallel_branches || []).length || (item.parallel_branches || []).some((value) => Number(value) === motorBranch)).length;
      container.append(el('small', 'cm-picker-meta', `Для a=${motorBranch} совместимых вариантов: ${matching}. Остальные оставлены видимыми для ручной проверки.`));
    }

    const grid = el('div', 'cm-picker-connections');
    options.forEach((option) => {
      const card = el('button', 'cm-picker-connection');
      card.type = 'button';
      if (state.selectedConnection?.connection_id === option.connection_id) card.classList.add('is-selected');
      const branches = option.parallel_branches || option.parallelBranches || [];
      if (Number.isFinite(motorBranch) && branches.length && !branches.some((value) => Number(value) === motorBranch)) {
        card.classList.add('is-nonmatching');
        card.title = `Вариант относится к a=${branches.join('/')}, а в карточке двигателя a=${motorBranch}`;
      }
      if (option.image) {
        const img = document.createElement('img');
        img.src = imageUrl(option.image);
        img.alt = connectionLabel(option);
        img.loading = 'lazy';
        card.append(img);
      }
      card.append(el('span', '', connectionLabel(option)));
      card.addEventListener('click', () => {
        state.selectedConnection = option;
        renderConnections(container);
      });
      grid.append(card);
    });
    container.append(grid);
  }

  function open(options = {}) {
    close();
    state.motor = options.motor || {};
    state.candidates = (options.candidates || window.CoilMasterSchemeVariants?.filtered || [])
      .map(normalizeCandidate);
    state.selectedScheme = state.candidates.find((x) => x.scheme_id === options.currentBinding?.scheme_id) || state.candidates[0] || null;
    state.selectedConnection = state.selectedScheme?.connection_options?.find((x) => x.connection_id === options.currentBinding?.connection_id) || null;

    const overlay = el('div', 'cm-picker-overlay');
    overlay.dataset.cmSchemePicker = '';
    const dialog = el('section', 'cm-picker-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const header = el('header', 'cm-picker-header');
    header.append(el('div', '', 'Выбор схемы обмотки'));
    const closeBtn = el('button', 'cm-picker-close', '×');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', close);
    header.append(closeBtn);

    const motorText = [state.motor.model, state.motor.slots && `${state.motor.slots} пазов`, state.motor.rpm && `${state.motor.rpm} об/мин`]
      .filter(Boolean).join(' · ');
    const intro = el('p', 'cm-picker-intro', motorText || 'Выберите подходящую схему и затем нужный вариант подключения.');

    const body = el('div', 'cm-picker-body');
    const list = el('div', 'cm-picker-schemes');
    const detail = el('div', 'cm-picker-detail');
    const connections = el('div', 'cm-picker-connections-wrap');

    function renderDetail() {
      detail.replaceChildren();
      if (!state.selectedScheme) {
        detail.append(el('p', 'cm-picker-empty', 'Подходящие схемы пока не найдены.'));
        connections.replaceChildren();
        return;
      }
      const s = state.selectedScheme;
      if (s.image) {
        const img = document.createElement('img');
        img.className = 'cm-picker-main-image';
        img.src = imageUrl(s.image);
        img.alt = s.description;
        detail.append(img);
      }
      detail.append(el('strong', '', s.description));
      const meta = [s.pitch && `y=${s.pitch}`, s.parallel_branches.length && `a=${s.parallel_branches.join(', ')}`, s.winding_types.join(', ')]
        .filter(Boolean).join(' · ');
      if (meta) detail.append(el('small', 'cm-picker-meta', meta));
      renderConnections(connections);
    }

    state.candidates.forEach((scheme) => {
      const btn = el('button', 'cm-picker-scheme', scheme.description);
      btn.type = 'button';
      if (scheme === state.selectedScheme) btn.classList.add('is-selected');
      btn.addEventListener('click', () => {
        state.selectedScheme = scheme;
        state.selectedConnection = null;
        list.querySelectorAll('.cm-picker-scheme').forEach((n) => n.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        renderDetail();
      });
      list.append(btn);
    });

    body.append(list, detail, connections);

    const footer = el('footer', 'cm-picker-footer');
    const cancel = el('button', 'cm-picker-secondary', 'Отмена');
    cancel.type = 'button';
    cancel.addEventListener('click', close);
    const accept = el('button', 'cm-picker-primary', 'Привязать к двигателю');
    accept.type = 'button';
    accept.disabled = !state.selectedScheme;
    accept.addEventListener('click', () => {
      const binding = buildBinding();
      const detail = { binding, scheme: state.selectedScheme, connection: state.selectedConnection, motor: state.motor };
      document.dispatchEvent(new CustomEvent('coilmaster:scheme-binding-selected', { detail }));
      options.onSelect?.(detail);
      close();
    });
    footer.append(cancel, accept);

    dialog.append(header, intro, body, footer);
    overlay.append(dialog);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.append(overlay);
    renderDetail();
  }

  window.CoilMasterSchemePicker = { open, close };
})();
