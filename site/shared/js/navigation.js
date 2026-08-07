(() => {
  'use strict';

  const STORAGE_KEY = 'coilmaster-handbook-interface';
  const button = document.querySelector('[data-menu-toggle]');
  const sidebar = document.querySelector('[data-sidebar]');

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

  addInterfaceControls();

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
