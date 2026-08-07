(() => {
  'use strict';

  const button = document.querySelector('[data-menu-toggle]');
  const sidebar = document.querySelector('[data-sidebar]');

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
