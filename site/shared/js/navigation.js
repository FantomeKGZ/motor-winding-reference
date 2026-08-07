(() => {
  'use strict';

  const STORAGE_KEY = 'coilmaster-handbook-interface';
  const button = document.querySelector('[data-menu-toggle]');
  const sidebar = document.querySelector('[data-sidebar]');
  const searchInput = document.querySelector('.cm-search');

  function storeInterface(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Navigation must continue to work when localStorage is unavailable.
    }
  }

  function detectCurrentInterface() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.includes('desktop')) return 'desktop';
    if (parts.includes('mobile')) return 'mobile';
    return null;
  }

  function buildSiblingUrl(target) {
    const url = new URL(window.location.href);
    const parts = url.pathname.split('/');
    const current = detectCurrentInterface();

    if (!current) return `../${target}/`;

    const index = parts.indexOf(current);
    if (index >= 0) {
      parts[index] = target;
      url.pathname = parts.join('/');
      url.search = '';
      url.hash = '';
      return url.href;
    }

    return `../${target}/`;
  }

  function addInterfaceControls() {
    const current = detectCurrentInterface();
    if (!current) return;

    const target = current === 'desktop' ? 'mobile' : 'desktop';
    const targetLabel = target === 'desktop' ? 'Версия для компьютера' : 'Версия для телефона';

    const nav = sidebar?.querySelector('.cm-nav:last-of-type');
    if (nav) {
      const switchLink = document.createElement('a');
      switchLink.href = buildSiblingUrl(target);
      switchLink.textContent = targetLabel;
      switchLink.dataset.interfaceSwitch = target;
      nav.appendChild(switchLink);

      const selectorLink = document.createElement('a');
      selectorLink.href = '../index.html?choose=1';
      selectorLink.textContent = 'Выбор интерфейса';
      nav.appendChild(selectorLink);
    }

    document.querySelectorAll('[data-interface-switch]').forEach((link) => {
      link.addEventListener('click', () => storeInterface(link.dataset.interfaceSwitch));
    });
  }

  function normalizeSearchText(value) {
    return value
      .toLocaleLowerCase('ru-RU')
      .replace(/[×xх]/g, ' ')
      .replace(/[^a-zа-яё0-9]+/gi, ' ')
      .trim();
  }

  function rowSearchText(row) {
    const hrefs = Array.from(row.querySelectorAll('a[href]'))
      .map((link) => decodeURIComponent(link.getAttribute('href') || ''))
      .join(' ');
    return normalizeSearchText(`${row.textContent || ''} ${hrefs}`);
  }

  function linkSearchText(link) {
    let href = '';
    try {
      href = decodeURIComponent(link.getAttribute('href') || '');
    } catch {
      href = link.getAttribute('href') || '';
    }
    return normalizeSearchText(`${link.textContent || ''} ${href} ${link.title || ''}`);
  }

  function clearSearchHighlights() {
    document.querySelectorAll('.cm-search-hit').forEach((node) => node.classList.remove('cm-search-hit'));
    document.querySelectorAll('.cm-search-row-hit').forEach((node) => node.classList.remove('cm-search-row-hit'));
  }

  function enableTableSearch() {
    if (!searchInput || searchInput.dataset.searchReady === '1') return;
    searchInput.dataset.searchReady = '1';

    let lastScrolledQuery = '';
    let status = document.querySelector('.cm-search-status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'cm-search-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      searchInput.insertAdjacentElement('afterend', status);
    }

    const applyFilter = () => {
      const rows = Array.from(document.querySelectorAll('.legacy-table tr'))
        .filter((row) => row.querySelector('td, th'));
      const query = normalizeSearchText(searchInput.value);
      const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
      const numericTokens = tokens.filter((token) => /^\d+$/.test(token));
      let visibleCount = 0;
      const exactHits = [];

      clearSearchHighlights();

      rows.forEach((row) => {
        const isHeader = !row.querySelector('a[href]') && row.parentElement?.tagName === 'THEAD';
        const rowText = rowSearchText(row);
        const visible = !tokens.length || isHeader || tokens.every((token) => rowText.includes(token));
        row.hidden = !visible;

        if (visible && !isHeader) {
          visibleCount += 1;
          if (tokens.length) row.classList.add('cm-search-row-hit');
        }

        if (!visible || numericTokens.length < 2) return;

        row.querySelectorAll('a[href]').forEach((link) => {
          const text = linkSearchText(link);
          if (numericTokens.every((token) => text.includes(token))) {
            const cell = link.closest('td, th') || link;
            cell.classList.add('cm-search-hit');
            exactHits.push(cell);
          }
        });
      });

      if (!tokens.length) {
        status.textContent = '';
        lastScrolledQuery = '';
      } else if (exactHits.length) {
        status.textContent = `Найдено точных схем: ${exactHits.length}. Строк: ${visibleCount}`;
      } else if (visibleCount) {
        status.textContent = `Найдено строк: ${visibleCount}`;
      } else {
        status.textContent = 'В главной таблице совпадений нет';
      }

      if (exactHits.length && query !== lastScrolledQuery) {
        lastScrolledQuery = query;
        exactHits[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    };

    searchInput.addEventListener('input', applyFilter);
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        searchInput.value = '';
        applyFilter();
        searchInput.blur();
      } else if (event.key === 'Enter') {
        const firstHit = document.querySelector('.cm-search-hit a[href], .cm-search-hit');
        if (firstHit) {
          event.preventDefault();
          firstHit.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      }
    });

    document.addEventListener('handbook:content-loaded', applyFilter);
  }

  function loadScriptOnce(src) {
    if (document.querySelector(`script[src$="${src.split('/').pop()}"]`)) return Promise.resolve();
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', resolve, { once: true });
      document.body.appendChild(script);
    });
  }

  function loadStyleOnce(href) {
    if (document.querySelector(`link[href$="${href.split('/').pop()}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  addInterfaceControls();
  enableTableSearch();
  loadStyleOnce('../shared/css/search-filters.css');
  loadStyleOnce('../shared/css/recent-history.css');
  loadStyleOnce('../shared/css/favorites.css');
  loadStyleOnce('../shared/css/page-parameters.css');
  loadStyleOnce('../shared/css/esp32-panel.css');
  loadStyleOnce('../shared/css/special-schemes.css');
  loadStyleOnce('../shared/css/scheme-picker.css');
  loadStyleOnce('../shared/css/motor-scheme-widget.css');
  loadScriptOnce('../shared/js/home-content-loader.js');
  loadScriptOnce('../shared/js/fulltext-search.js');
  loadScriptOnce('../shared/js/recent-history.js');
  loadScriptOnce('../shared/js/favorites.js');
  loadScriptOnce('../shared/js/page-parameters.js');
  loadScriptOnce('../shared/js/special-scheme-classifier.js');
  loadScriptOnce('../shared/js/scheme-picker.js').then(() => loadScriptOnce('../shared/js/motor-scheme-widget.js'));
  loadScriptOnce('../shared/js/esp32-client.js')
    .then(() => Promise.all([
      loadScriptOnce('../shared/js/esp32-panel.js'),
      loadScriptOnce('../shared/js/esp32-scheme-matcher.js'),
      loadScriptOnce('../shared/js/motor-binding-client.js'),
    ]));

  if (!button || !sidebar) return;

  const closeMenu = () => {
    sidebar.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(isOpen));
  });

  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a') && window.matchMedia('(max-width: 800px)').matches) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
})();