(() => {
  'use strict';

  const STORAGE_KEY = 'coilmaster-handbook-recent-pages';
  const MAX_ITEMS = 8;
  const sidebar = document.querySelector('[data-sidebar]');
  const current = window.location.pathname.split('/').filter(Boolean)
    .find((part) => part === 'desktop' || part === 'mobile');

  if (!sidebar || !current) return;

  if (!document.querySelector('link[href$="recent-history.css"]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = '../shared/css/recent-history.css';
    document.head.appendChild(style);
  }

  function readHistory() {
    try {
      const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeHistory(items) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
    } catch {
      // History is optional and must not affect navigation.
    }
  }

  function cleanTitle(value) {
    return String(value || '')
      .replace(/\s+[—-]\s+CoilMaster\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function currentEntry() {
    if (!/\/page\.html$/i.test(window.location.pathname)) return null;
    const params = new URLSearchParams(window.location.search);
    const src = (params.get('src') || '').replace(/^\/+/, '');
    if (!src || src.includes('..') || !/\.html?$/i.test(src)) return null;

    return {
      interface: current,
      src,
      title: cleanTitle(document.title) || src,
      openedAt: Date.now(),
    };
  }

  function saveCurrentPage() {
    const entry = currentEntry();
    if (!entry) return;

    const history = readHistory().filter((item) => !(item.interface === entry.interface && item.src === entry.src));
    history.unshift(entry);
    writeHistory(history);
    renderHistory();
  }

  function itemUrl(item) {
    if (item.interface === current) {
      return `page.html?src=${encodeURIComponent(item.src)}`;
    }
    return `../${item.interface}/page.html?src=${encodeURIComponent(item.src)}`;
  }

  function renderHistory() {
    sidebar.querySelector('[data-recent-history-section]')?.remove();

    const items = readHistory().filter((item) => item && item.src && item.title).slice(0, MAX_ITEMS);
    if (!items.length) return;

    const section = document.createElement('div');
    section.dataset.recentHistorySection = '';

    const heading = document.createElement('div');
    heading.className = 'cm-nav-title';
    heading.textContent = 'Недавние страницы';

    const nav = document.createElement('nav');
    nav.className = 'cm-nav cm-recent-nav';
    nav.setAttribute('aria-label', 'Недавние страницы справочника');

    items.forEach((item) => {
      const link = document.createElement('a');
      link.href = itemUrl(item);
      link.title = item.title;

      const text = document.createElement('span');
      text.className = 'cm-recent-title';
      text.textContent = item.title;

      const meta = document.createElement('small');
      meta.textContent = item.interface === 'mobile' ? 'мобильная' : 'ПК';

      link.append(text, meta);
      nav.appendChild(link);
    });

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'cm-recent-clear';
    clear.textContent = 'Очистить историю';
    clear.addEventListener('click', () => {
      writeHistory([]);
      renderHistory();
    });

    section.append(heading, nav, clear);
    sidebar.appendChild(section);
  }

  renderHistory();

  if (/\/page\.html$/i.test(window.location.pathname)) {
    document.addEventListener('handbook:content-loaded', saveCurrentPage, { once: true });
    window.setTimeout(() => {
      if (!document.querySelector('[data-legacy-page] .original-page-content')) return;
      saveCurrentPage();
    }, 1200);
  }
})();
