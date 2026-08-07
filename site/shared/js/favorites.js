(() => {
  'use strict';

  const STORAGE_KEY = 'coilmaster-handbook-favorites';
  const sidebar = document.querySelector('[data-sidebar]');
  const current = window.location.pathname.split('/').filter(Boolean)
    .find((part) => part === 'desktop' || part === 'mobile');

  if (!sidebar || !current) return;

  function readFavorites() {
    try {
      const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeFavorites(items) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Favorites are optional and must not break the handbook.
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
    };
  }

  function isFavorite(entry) {
    return readFavorites().some((item) => item.interface === entry.interface && item.src === entry.src);
  }

  function toggleFavorite(entry) {
    const favorites = readFavorites();
    const index = favorites.findIndex((item) => item.interface === entry.interface && item.src === entry.src);

    if (index >= 0) favorites.splice(index, 1);
    else favorites.unshift(entry);

    writeFavorites(favorites);
    renderFavorites();
    updatePageButton();
  }

  function itemUrl(item) {
    if (item.interface === current) {
      return `page.html?src=${encodeURIComponent(item.src)}`;
    }
    return `../${item.interface}/page.html?src=${encodeURIComponent(item.src)}`;
  }

  function renderFavorites() {
    sidebar.querySelector('[data-favorites-section]')?.remove();
    const items = readFavorites().filter((item) => item && item.src && item.title);
    if (!items.length) return;

    const section = document.createElement('div');
    section.dataset.favoritesSection = '';

    const heading = document.createElement('div');
    heading.className = 'cm-nav-title';
    heading.textContent = 'Избранное';

    const nav = document.createElement('nav');
    nav.className = 'cm-nav cm-favorites-nav';
    nav.setAttribute('aria-label', 'Избранные страницы справочника');

    items.forEach((item) => {
      const link = document.createElement('a');
      link.href = itemUrl(item);
      link.title = item.title;

      const star = document.createElement('span');
      star.className = 'cm-favorite-star-small';
      star.textContent = '★';
      star.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.className = 'cm-favorite-title';
      text.textContent = item.title;

      link.append(star, text);
      nav.appendChild(link);
    });

    section.append(heading, nav);
    sidebar.appendChild(section);
  }

  function updatePageButton() {
    const button = document.querySelector('[data-favorite-toggle]');
    const entry = currentEntry();
    if (!button || !entry) return;

    const active = isFavorite(entry);
    button.classList.toggle('is-favorite', active);
    button.setAttribute('aria-pressed', String(active));
    button.title = active ? 'Убрать из избранного' : 'Добавить в избранное';
    button.textContent = active ? '★ В избранном' : '☆ В избранное';
  }

  function installPageButton() {
    const controls = document.querySelector('.legacy-page-controls');
    const entry = currentEntry();
    if (!controls || !entry || controls.querySelector('[data-favorite-toggle]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'legacy-page-control cm-favorite-toggle';
    button.dataset.favoriteToggle = '';
    button.addEventListener('click', () => toggleFavorite(entry));

    controls.insertBefore(button, controls.querySelector('.legacy-page-control-muted'));
    updatePageButton();
  }

  renderFavorites();

  if (/\/page\.html$/i.test(window.location.pathname)) {
    document.addEventListener('handbook:content-loaded', installPageButton);
    window.setTimeout(installPageButton, 1200);
  }
})();
