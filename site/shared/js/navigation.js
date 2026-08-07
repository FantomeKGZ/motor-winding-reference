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

  function enableTableSearch() {
    if (!searchInput) return;

    const rows = Array.from(document.querySelectorAll('.legacy-table tbody tr'));
    if (!rows.length) return;

    const status = document.createElement('div');
    status.className = 'cm-search-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    searchInput.insertAdjacentElement('afterend', status);

    const indexedRows = rows.map((row) => ({ row, text: rowSearchText(row) }));

    const applyFilter = () => {
      const query = normalizeSearchText(searchInput.value);
      const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
      let visibleCount = 0;

      indexedRows.forEach(({ row, text }) => {
        const visible = tokens.every((token) => text.includes(token));
        row.hidden = !visible;
        if (visible) visibleCount += 1;
      });

      if (!tokens.length) {
        status.textContent = '';
      } else if (visibleCount) {
        status.textContent = `Найдено строк: ${visibleCount}`;
      } else {
        status.textContent = 'Совпадений в текущей таблице нет';
      }
    };

    searchInput.addEventListener('input', applyFilter);
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        searchInput.value = '';
        applyFilter();
        searchInput.blur();
      }
    });
  }

  addInterfaceControls();
  enableTableSearch();

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
