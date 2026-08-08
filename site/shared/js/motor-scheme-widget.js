(() => {
  'use strict';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function currentInterface() {
    return window.location.pathname.includes('/mobile/') ? 'mobile' : 'desktop';
  }

  function sourceRoot() {
    return currentInterface() === 'mobile'
      ? '../../sourse/mobile/Справочник от 09.12.2024 для мобильных устройств HTML/'
      : '../../sourse/desktop/Справочник от 09.12.2024 HTML/';
  }

  function imageUrl(path) {
    if (!path) return '';
    return new URL(sourceRoot() + path, window.location.href).href;
  }

  function pageUrl(page, image) {
    const url = new URL('page.html', window.location.href);
    if (page) url.searchParams.set('src', page);
    if (image) url.searchParams.set('img', image);
    url.searchParams.set('from', 'motor-card');
    return `${url.pathname.split('/').pop()}${url.search}`;
  }

  function connectionLabel(item) {
    const type = item?.type || item?.kind || '';
    let label = '';
    if (type === 'star') label = 'Звезда';
    else if (type === 'delta') label = 'Треугольник';
    else if (type === 'double_star') label = 'Двойная звезда';
    else if (type === 'dahlander') label = 'Даландер';
    else if (type === 'star_delta') label = 'Звезда / треугольник';
    else if (type === 'single_phase_winding') label = 'Соединение однофазной обмотки';
    else if (type === 'single_phase_supply') label = 'Подключение однофазного двигателя к сети';
    else label = item?.title || item?.page || 'Схема подключения';

    const branches = item?.parallel_branches || item?.parallelBranches || [];
    if (branches.length) label += ` · a=${branches.join(', ')}`;
    return label;
  }

  function normalizeScheme(input = {}) {
    return {
      scheme_id: input.scheme_id || input.id || '',
      legacy_page: input.legacy_page || input.target || '',
      image: input.image || '',
      description: input.description || input.section || 'Схема укладки',
      pitch: input.pitch || null,
      parallel_branches: input.parallel_branches || input.parallelBranches || [],
      winding_types: input.winding_types || input.windingTypes || [],
      connection_options: input.connection_options || input.connectionOptions || [],
    };
  }

  function normalizeBinding(binding = {}) {
    return {
      scheme_id: binding.scheme_id || null,
      connection_id: binding.connection_id || null,
      catalog_version: binding.catalog_version || null,
    };
  }

  function render(container, options = {}) {
    if (!container) return null;
    container.replaceChildren();
    container.classList.add('cm-motor-scheme-widget');

    const binding = normalizeBinding(options.binding || {});
    const scheme = options.scheme ? normalizeScheme(options.scheme) : null;
    const selectedConnection = options.connection
      || scheme?.connection_options.find((item) => item.connection_id === binding.connection_id)
      || null;

    const header = el('div', 'cm-msw-header');
    header.append(el('strong', '', 'Обмотка и схемы'));
    if (binding.scheme_id) header.append(el('code', 'cm-msw-id', binding.scheme_id));
    container.append(header);

    if (!scheme) {
      container.append(el('p', 'cm-msw-empty', 'Схема обмотки к этому двигателю пока не привязана.'));
      const choose = el('button', 'cm-msw-primary', 'Выбрать схему');
      choose.type = 'button';
      choose.addEventListener('click', () => options.onEdit?.({ binding, scheme: null, connection: null }));
      container.append(choose);
      return { binding, scheme: null, connection: null };
    }

    const layout = el('div', 'cm-msw-layout');
    const preview = el('a', 'cm-msw-layout-preview');
    preview.href = pageUrl(scheme.legacy_page, scheme.image);
    preview.title = 'Открыть схему укладки полностью';
    if (scheme.image) {
      const img = document.createElement('img');
      img.src = imageUrl(scheme.image);
      img.alt = scheme.description;
      img.loading = 'lazy';
      preview.append(img);
    } else {
      preview.append(el('span', 'cm-msw-noimage', 'Нет превью'));
    }

    const details = el('div', 'cm-msw-layout-details');
    details.append(el('strong', '', scheme.description));
    const meta = [
      scheme.pitch && `y=${scheme.pitch}`,
      scheme.parallel_branches.length && `a=${scheme.parallel_branches.join(', ')}`,
      scheme.winding_types.length && scheme.winding_types.join(', '),
    ].filter(Boolean).join(' · ');
    if (meta) details.append(el('small', 'cm-msw-meta', meta));
    const openLayout = el('a', 'cm-msw-link', 'Открыть укладку');
    openLayout.href = pageUrl(scheme.legacy_page, scheme.image);
    details.append(openLayout);
    layout.append(preview, details);
    container.append(layout);

    const connections = scheme.connection_options || [];
    const connSection = el('section', 'cm-msw-connections');
    const connHeader = el('div', 'cm-msw-connections-header');
    connHeader.append(el('strong', '', `Схемы подключения: ${connections.length}`));
    if (selectedConnection) connHeader.append(el('span', 'cm-msw-selected-badge', `Выбрано: ${connectionLabel(selectedConnection)}`));
    connSection.append(connHeader);

    if (!connections.length) {
      connSection.append(el('p', 'cm-msw-empty', 'Отдельная схема подключения для этой укладки в каталоге не найдена.'));
    } else {
      const previews = el('div', 'cm-msw-connection-grid');
      const visible = connections.slice(0, options.maxConnectionPreviews || 2);
      visible.forEach((item) => {
        const card = el('a', 'cm-msw-connection-card');
        if (selectedConnection?.connection_id === item.connection_id) card.classList.add('is-selected');
        card.href = pageUrl(item.page, item.image);
        card.title = connectionLabel(item);
        if (item.image) {
          const img = document.createElement('img');
          img.src = imageUrl(item.image);
          img.alt = connectionLabel(item);
          img.loading = 'lazy';
          card.append(img);
        }
        card.append(el('span', '', connectionLabel(item)));
        previews.append(card);
      });
      connSection.append(previews);

      if (connections.length > visible.length) {
        const more = el('button', 'cm-msw-secondary', `Все схемы подключения (${connections.length})`);
        more.type = 'button';
        more.addEventListener('click', () => options.onShowConnections?.({ binding, scheme, connections, selectedConnection }));
        connSection.append(more);
      }
    }
    container.append(connSection);

    const actions = el('div', 'cm-msw-actions');
    const edit = el('button', 'cm-msw-primary', 'Изменить привязку');
    edit.type = 'button';
    edit.addEventListener('click', () => options.onEdit?.({ binding, scheme, connection: selectedConnection }));
    const remove = el('button', 'cm-msw-secondary', 'Удалить привязку');
    remove.type = 'button';
    remove.addEventListener('click', () => options.onRemove?.({ binding, scheme, connection: selectedConnection }));
    actions.append(edit, remove);
    container.append(actions);

    return { binding, scheme, connection: selectedConnection };
  }

  function bindPicker(container, options = {}) {
    return render(container, {
      ...options,
      onEdit(detail) {
        const picker = window.CoilMasterSchemePicker;
        if (!picker) {
          options.onEdit?.(detail);
          return;
        }
        picker.open({
          motor: options.motor || {},
          candidates: options.candidates || [],
          currentBinding: detail.binding,
          onSelect(selection) {
            options.onBindingChange?.(selection);
          },
        });
      },
    });
  }

  window.CoilMasterMotorSchemeWidget = { render, bindPicker };
})();
