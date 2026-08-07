(() => {
  'use strict';

  const host = document.querySelector('[data-legacy-page]');
  if (!host) return;

  const PARAMETER_ALIASES = [
    { key: 'slots', label: 'Пазы', matches: ['количество пазов', 'число пазов'] },
    { key: 'rpm', label: 'Обороты', matches: ['частота вращения', 'об/мин'] },
    { key: 'poles', label: '2p', matches: ['число полюсов'] },
    { key: 'q', label: 'q', matches: ['число пазов на полюс и фазу'] },
    { key: 'phaseStart', label: 'Начало фаз', matches: ['начало фаз по пазам'] },
  ];

  function normalize(value) {
    return String(value || '')
      .toLocaleLowerCase('ru-RU')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractRows(root) {
    const rows = [];
    root.querySelectorAll('table tr').forEach((row) => {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (cells.length < 2) return;
      const values = cells.map((cell) => cell.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (values.length < 2) return;
      rows.push({ row, values, normalized: values.map(normalize) });
    });
    return rows;
  }

  function findValue(rows, definition) {
    for (const entry of rows) {
      const joined = entry.normalized.join(' ');
      if (!definition.matches.some((needle) => joined.includes(needle))) continue;

      const useful = entry.values.filter((value) => {
        const normalized = normalize(value);
        return !definition.matches.some((needle) => normalized.includes(needle));
      });

      if (!useful.length) continue;

      if (definition.key === 'rpm') {
        const numeric = useful.find((value) => /\d{3,5}/.test(value));
        if (numeric) return numeric;
      }
      if (definition.key === 'slots' || definition.key === 'poles' || definition.key === 'q') {
        const numeric = [...useful].reverse().find((value) => /\d/.test(value));
        if (numeric) return numeric;
      }
      return useful[useful.length - 1];
    }
    return '';
  }

  function numberFrom(value) {
    if (!value) return null;
    const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function buildSchemeContext(values) {
    const raw = Object.fromEntries(values.map((item) => [item.key, item.value]));
    const params = new URLSearchParams(window.location.search);
    const sourcePath = (params.get('src') || '').replace(/^\/+/, '');

    return {
      version: 1,
      source: 'legacy-handbook',
      source_path: sourcePath || null,
      title: document.title.replace(/\s+[—-]\s+CoilMaster\s*$/i, '').trim(),
      slots: numberFrom(raw.slots),
      rpm: numberFrom(raw.rpm),
      poles: numberFrom(raw.poles),
      q: numberFrom(raw.q),
      phase_start: raw.phaseStart || null,
      raw,
    };
  }

  function publishSchemeContext(context, section) {
    window.CoilMasterSchemeContext = context;
    section.dataset.schemeContextVersion = String(context.version);
    if (context.slots != null) section.dataset.slots = String(context.slots);
    if (context.rpm != null) section.dataset.rpm = String(context.rpm);
    if (context.poles != null) section.dataset.poles = String(context.poles);
    if (context.q != null) section.dataset.q = String(context.q);

    document.dispatchEvent(new CustomEvent('coilmaster:scheme-context', {
      detail: context,
    }));
  }

  function buildParameterBar(root) {
    const rows = extractRows(root);
    const values = PARAMETER_ALIASES
      .map((definition) => ({ ...definition, value: findValue(rows, definition) }))
      .filter((item) => item.value);

    if (values.length < 2) return null;

    const section = document.createElement('section');
    section.className = 'cm-page-parameters';
    section.setAttribute('aria-label', 'Основные параметры схемы');

    const title = document.createElement('strong');
    title.className = 'cm-page-parameters-title';
    title.textContent = 'Параметры схемы';

    const list = document.createElement('div');
    list.className = 'cm-page-parameters-list';

    values.forEach((item) => {
      const entry = document.createElement('div');
      entry.className = 'cm-page-parameter';

      const label = document.createElement('span');
      label.textContent = item.label;

      const value = document.createElement('strong');
      value.textContent = item.value;

      entry.append(label, value);
      list.appendChild(entry);
    });

    section.append(title, list);
    return { section, context: buildSchemeContext(values) };
  }

  function install() {
    if (host.querySelector('.cm-page-parameters')) return;
    const original = host.querySelector('.original-page-content');
    if (!original) return;

    const result = buildParameterBar(original);
    if (!result) return;

    const controls = host.querySelector('.legacy-page-controls');
    if (controls) controls.insertAdjacentElement('afterend', result.section);
    else host.prepend(result.section);

    publishSchemeContext(result.context, result.section);
  }

  document.addEventListener('handbook:content-loaded', install);
  install();
})();
