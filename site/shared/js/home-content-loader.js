(() => {
  'use strict';

  const current = window.location.pathname.split('/').filter(Boolean).find((part) => part === 'desktop' || part === 'mobile');
  const host = document.querySelector('.legacy-content');
  if (!current || !host) return;

  const SCROLL_KEY = `coilmaster-handbook-home-scroll-${current}`;
  const sourceRoot = current === 'desktop'
    ? '../../sourse/desktop/Справочник от 09.12.2024 HTML/'
    : '../../sourse/mobile/Справочник от 09.12.2024 для мобильных устройств HTML/';
  const sourceUrl = new URL(`${sourceRoot}index.html`, window.location.href);
  const rootUrl = new URL(sourceRoot, window.location.href);

  function isExternal(value) {
    return /^(?:https?:|mailto:|tel:|javascript:|data:)/i.test(value);
  }

  function sourceRelativePath(url) {
    if (url.origin !== rootUrl.origin || !url.pathname.startsWith(rootUrl.pathname)) return null;
    return decodeURIComponent(url.pathname.slice(rootUrl.pathname.length));
  }

  function rememberHomePosition() {
    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ y: window.scrollY, at: Date.now() }));
    } catch {
      // The handbook still works when sessionStorage is unavailable.
    }
  }

  function restoreHomePositionIfRequested() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('restore') !== '1') return;

    try {
      const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null');
      sessionStorage.removeItem(SCROLL_KEY);
      if (!saved || !Number.isFinite(saved.y) || Date.now() - saved.at > 60 * 60 * 1000) return;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.scrollTo({ top: saved.y, behavior: 'auto' }));
      });
    } catch {
      // Ignore malformed or unavailable session storage.
    }

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('restore');
    window.history.replaceState(null, '', cleanUrl);
  }

  function rewriteResourceUrls(root) {
    root.querySelectorAll('a[href]').forEach((node) => {
      const value = node.getAttribute('href');
      if (!value || value.startsWith('#') || isExternal(value)) return;

      const target = new URL(value, sourceUrl);
      const relative = sourceRelativePath(target);
      if (!relative) {
        node.href = target.href;
        return;
      }

      if (/\.html?$/i.test(relative)) {
        if (/^index\.html?$/i.test(relative)) {
          node.href = 'index.html';
        } else {
          node.href = `page.html?src=${encodeURIComponent(relative)}&from=home`;
          node.addEventListener('click', rememberHomePosition);
        }
        return;
      }

      node.href = target.href;
    });

    root.querySelectorAll('[src]').forEach((node) => {
      const value = node.getAttribute('src');
      if (!value || isExternal(value)) return;
      node.src = new URL(value, sourceUrl).href;
    });
  }

  function removeLegacyBanner(root) {
    root.querySelectorAll('img').forEach((image) => {
      const src = (image.getAttribute('src') || '').toLowerCase();
      const alt = (image.getAttribute('alt') || '').toLowerCase();
      if (src.includes('verh.') || alt.includes('справочник обмотчика асинхронных электродвигателей')) {
        const container = image.closest('div, p, table, center') || image;
        container.remove();
      }
    });
  }

  function prepareOriginalContent(sourceContent) {
    const wrapper = document.createElement('div');
    wrapper.className = 'original-home-content';
    wrapper.innerHTML = sourceContent.innerHTML;
    rewriteResourceUrls(wrapper);
    removeLegacyBanner(wrapper);

    wrapper.querySelectorAll('table').forEach((table) => {
      table.classList.add('legacy-table');
      if (!table.parentElement?.classList.contains('table-scroll')) {
        const scroll = document.createElement('div');
        scroll.className = 'table-scroll';
        table.replaceWith(scroll);
        scroll.appendChild(table);
      }
    });

    wrapper.querySelectorAll('img').forEach((image) => {
      image.loading = 'lazy';
      image.decoding = 'async';
    });

    return wrapper;
  }

  async function loadOriginalHome() {
    host.innerHTML = '<p class="legacy-loading">Загрузка справочника…</p>';

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const bytes = await response.arrayBuffer();
      const html = new TextDecoder('windows-1251').decode(bytes);
      const sourceDocument = new DOMParser().parseFromString(html, 'text/html');
      const sourceContent = sourceDocument.querySelector('.content') || sourceDocument.body;
      const original = prepareOriginalContent(sourceContent);

      host.replaceChildren(original);
      restoreHomePositionIfRequested();
      document.dispatchEvent(new CustomEvent('handbook:content-loaded'));
    } catch (error) {
      host.innerHTML = '<p class="legacy-note">Не удалось загрузить оригинальную главную страницу.</p>';
      console.error('Handbook home loading failed:', error);
    }
  }

  loadOriginalHome();
})();
