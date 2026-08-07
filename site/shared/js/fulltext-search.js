(() => {
  'use strict';

  const input = document.querySelector('.cm-search');
  if (!input) return;

  const current = window.location.pathname.split('/').filter(Boolean)
    .find((part) => part === 'desktop' || part === 'mobile');
  if (!current) return;

  if (!document.querySelector('link[data-search-filters-style]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = '../shared/css/search-filters.css';
    style.dataset.searchFiltersStyle = '';
    document.head.appendChild(style);
  }

  const INDEX_URL = `../shared/data/${current}-search-index.json`;
  const MIN_QUERY_LENGTH = 3;
  const MAX_RESULTS = 12;
  const FILTERS = [
    { key: 'all', label: 'Все' },
    { key: 'winding-layout', label: 'Схемы укладки' },
    { key: 'connection', label: 'Схемы соединения' },
    { key: 'motor-data', label: 'Двигатели' },
    { key: 'table', label: 'Таблицы' },
    { key: 'reference', label: 'Справочные' },
  ];

  let indexPromise = null;
  let timer = null;
  let activeFilter = 'all';
  let lastSearch = null;

  function normalize(value) {
    return String(value || '')
      .toLocaleLowerCase('ru-RU')
      .replace(/[×xх]/g, ' ')
      .replace(/[^a-zа-яё0-9]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isTableParameterQuery(query) {
    const tokens = query.split(' ').filter(Boolean);
    return tokens.length >= 2 && tokens.every((token) => /^\d+$/.test(token));
  }

  function getResultsHost() {
    let host = document.querySelector('[data-fulltext-results]');
    if (host) return host;

    host = document.createElement('section');
    host.className = 'cm-fulltext-results';
    host.dataset.fulltextResults = '';
    host.hidden = true;
    host.setAttribute('aria-label', 'Результаты поиска по всему справочнику');

    const toolbar = document.querySelector('.cm-toolbar');
    toolbar?.insertAdjacentElement('afterend', host);
    return host;
  }

  function hideResults() {
    const host = document.querySelector('[data-fulltext-results]');
    if (host) host.hidden = true;
  }

  async function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(INDEX_URL)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((payload) => Array.isArray(payload) ? payload : (payload.pages || payload.items || []));
    }
    return indexPromise;
  }

  function scoreItem(item, tokens, normalizedQuery) {
    const title = normalize(item.title);
    const path = normalize(item.path);
    const type = normalize(item.type_label || item.type);
    const text = normalize(item.search || item.text || item.content || item.excerpt || item.snippet);
    const haystack = `${title} ${path} ${type} ${text}`;
    if (!tokens.every((token) => haystack.includes(token))) return -1;

    let score = 0;
    if (title === normalizedQuery) score += 120;
    if (title.includes(normalizedQuery)) score += 70;
    if (type.includes(normalizedQuery)) score += 45;
    if (path.includes(normalizedQuery)) score += 35;
    if (text.includes(normalizedQuery)) score += 20;

    tokens.forEach((token) => {
      if (title.includes(token)) score += 18;
      if (type.includes(token)) score += 12;
      if (path.includes(token)) score += 8;
      if (text.includes(token)) score += 2;
    });
    return score;
  }

  function makeSnippet(item, tokens) {
    const source = String(item.excerpt || item.snippet || item.text || item.content || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!source) return '';

    const lower = source.toLocaleLowerCase('ru-RU');
    let at = -1;
    for (const token of tokens) {
      const found = lower.indexOf(token);
      if (found >= 0 && (at < 0 || found < at)) at = found;
    }

    if (at < 0) return source.slice(0, 240);
    const start = Math.max(0, at - 90);
    const end = Math.min(source.length, at + 190);
    return `${start ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
  }

  function pageUrl(path) {
    return `page.html?src=${encodeURIComponent(path)}`;
  }

  function normalizedType(item) {
    const type = String(item.type || 'page');
    if (FILTERS.some((filter) => filter.key === type)) return type;
    return type === 'reference-material' ? 'reference' : 'page';
  }

  function filteredItems(items) {
    if (activeFilter === 'all') return items;
    return items.filter((item) => normalizedType(item) === activeFilter);
  }

  function buildFilters(items) {
    const nav = document.createElement('div');
    nav.className = 'cm-fulltext-filters';
    nav.setAttribute('role', 'group');
    nav.setAttribute('aria-label', 'Фильтр результатов поиска');

    const counts = new Map();
    items.forEach((item) => {
      const type = normalizedType(item);
      counts.set(type, (counts.get(type) || 0) + 1);
    });

    FILTERS.forEach((filter) => {
      const count = filter.key === 'all' ? items.length : (counts.get(filter.key) || 0);
      if (filter.key !== 'all' && count === 0) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-fulltext-filter';
      button.dataset.filter = filter.key;
      button.setAttribute('aria-pressed', String(activeFilter === filter.key));
      button.textContent = `${filter.label} (${count})`;
      button.addEventListener('click', () => {
        activeFilter = filter.key;
        if (lastSearch) renderResults(lastSearch.items, lastSearch.query, lastSearch.tokens);
      });
      nav.appendChild(button);
    });

    return nav;
  }

  function renderResults(items, query, tokens) {
    const host = getResultsHost();
    host.replaceChildren();
    lastSearch = { items, query, tokens };

    const header = document.createElement('div');
    header.className = 'cm-fulltext-results-header';

    const visibleItems = filteredItems(items);
    const title = document.createElement('strong');
    title.textContent = items.length
      ? `Поиск: найдено ${items.length}${activeFilter !== 'all' ? `, в фильтре ${visibleItems.length}` : ''}`
      : 'Поиск по всему справочнику: ничего не найдено';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cm-fulltext-close';
    close.textContent = 'Закрыть';
    close.addEventListener('click', hideResults);

    header.append(title, close);
    host.appendChild(header);

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'cm-fulltext-empty';
      empty.textContent = `По запросу «${query}» страниц не найдено.`;
      host.appendChild(empty);
      host.hidden = false;
      return;
    }

    host.appendChild(buildFilters(items));

    if (!visibleItems.length) {
      const empty = document.createElement('p');
      empty.className = 'cm-fulltext-empty';
      empty.textContent = 'В выбранной категории совпадений нет.';
      host.appendChild(empty);
      host.hidden = false;
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'cm-fulltext-summary';
    summary.textContent = `Показано ${Math.min(visibleItems.length, MAX_RESULTS)} из ${visibleItems.length}`;
    host.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'cm-fulltext-list';

    visibleItems.slice(0, MAX_RESULTS).forEach((item) => {
      const card = document.createElement('a');
      card.className = 'cm-fulltext-item';
      card.href = pageUrl(item.path);

      const headingRow = document.createElement('span');
      headingRow.className = 'cm-fulltext-heading-row';

      const heading = document.createElement('strong');
      heading.textContent = item.title || item.path;

      const badge = document.createElement('span');
      badge.className = 'cm-fulltext-type';
      badge.dataset.type = item.type || 'page';
      badge.textContent = item.type_label || 'Страница справочника';

      const snippet = document.createElement('span');
      snippet.className = 'cm-fulltext-snippet';
      snippet.textContent = makeSnippet(item, tokens);

      const path = document.createElement('small');
      path.textContent = item.path;

      headingRow.append(heading, badge);
      card.append(headingRow, snippet, path);
      list.appendChild(card);
    });

    host.appendChild(list);
    host.hidden = false;
  }

  async function runSearch() {
    const query = normalize(input.value);

    if (query.length < MIN_QUERY_LENGTH || isTableParameterQuery(query)) {
      hideResults();
      lastSearch = null;
      activeFilter = 'all';
      return;
    }

    const tokens = query.split(' ').filter(Boolean);
    try {
      const index = await loadIndex();
      const ranked = index
        .map((item) => ({ item, score: scoreItem(item, tokens, query) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score || String(a.item.title || '').localeCompare(String(b.item.title || ''), 'ru'))
        .map((entry) => entry.item);

      activeFilter = 'all';
      renderResults(ranked, input.value.trim(), tokens);
    } catch (error) {
      hideResults();
      console.warn('Full-text index is unavailable:', error);
    }
  }

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(runSearch, 180);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideResults();
  });
})();
