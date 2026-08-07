(() => {
  'use strict';

  const current = window.location.pathname.split('/').filter(Boolean).find((part) => part === 'desktop' || part === 'mobile');
  const host = document.querySelector('[data-legacy-page]');
  if (!current || !host) return;

  const params = new URLSearchParams(window.location.search);
  const requested = (params.get('src') || '').replace(/^\/+/, '');
  const safePath = requested && !requested.includes('..') && /\.html?$/i.test(requested) ? requested : '';

  const sourceRoot = current === 'desktop'
    ? '../../sourse/desktop/Справочник от 09.12.2024 HTML/'
    : '../../sourse/mobile/Справочник от 09.12.2024 для мобильных устройств HTML/';

  const sourceUrl = safePath ? new URL(`${sourceRoot}${safePath}`, window.location.href) : null;

  function isExternal(value) {
    return /^(?:https?:|mailto:|tel:|javascript:|data:)/i.test(value);
  }

  function relativeSourcePath(url) {
    const rootUrl = new URL(sourceRoot, window.location.href);
    if (url.origin !== rootUrl.origin || !url.pathname.startsWith(rootUrl.pathname)) return null;
    return decodeURIComponent(url.pathname.slice(rootUrl.pathname.length));
  }

  function rewriteLinks(root) {
    root.querySelectorAll('a[href]').forEach((link) => {
      const value = link.getAttribute('href');
      if (!value || value.startsWith('#') || isExternal(value)) return;

      const target = new URL(value, sourceUrl);
      const relative = relativeSourcePath(target);
      if (!relative) {
        link.href = target.href;
        return;
      }

      if (/\.html?$/i.test(relative)) {
        if (/^index\.html?$/i.test(relative)) {
          link.href = 'index.html';
        } else {
          link.href = `page.html?src=${encodeURIComponent(relative)}`;
        }
        return;
      }

      link.href = target.href;
    });

    root.querySelectorAll('[src]').forEach((node) => {
      const value = node.getAttribute('src');
      if (!value || isExternal(value)) return;
      node.src = new URL(value, sourceUrl).href;
    });
  }

  function buildPageControls() {
    const controls = document.createElement('nav');
    controls.className = 'legacy-page-controls';
    controls.setAttribute('aria-label', 'Навигация по справочнику');

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'legacy-page-control';
    back.textContent = '← Назад';
    back.addEventListener('click', () => {
      if (window.history.length > 1) window.history.back();
      else window.location.href = 'index.html';
    });

    const home = document.createElement('a');
    home.className = 'legacy-page-control';
    home.href = 'index.html';
    home.textContent = 'К таблице схем';

    const original = document.createElement('a');
    original.className = 'legacy-page-control legacy-page-control-muted';
    original.href = sourceUrl.href;
    original.textContent = 'Оригинальная страница';

    controls.append(back, home, original);
    return controls;
  }

  function installBackToTop() {
    if (document.querySelector('[data-back-to-top]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-back-to-top';
    button.dataset.backToTop = '';
    button.hidden = true;
    button.setAttribute('aria-label', 'Наверх');
    button.title = 'Наверх';
    button.textContent = '↑';

    const updateVisibility = () => {
      button.hidden = window.scrollY < 700;
    };

    button.addEventListener('click', () => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });

    window.addEventListener('scroll', updateVisibility, { passive: true });
    updateVisibility();
    document.body.appendChild(button);
  }

  function prepareContent(sourceDocument) {
    const sourceContent = sourceDocument.querySelector('.content') || sourceDocument.body;
    const wrapper = document.createElement('div');
    wrapper.className = 'original-page-content';
    wrapper.innerHTML = sourceContent.innerHTML;

    // The old graphical header is deliberately not imported. The technical page content is preserved.
    wrapper.querySelectorAll('.verh').forEach((node) => node.remove());
    rewriteLinks(wrapper);

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

  async function loadPage() {
    if (!sourceUrl) {
      host.innerHTML = '<p class="legacy-note">Страница не указана или путь недопустим. Вернитесь на главную страницу справочника.</p>';
      return;
    }

    host.innerHTML = '<p class="legacy-note" data-page-loading>Загрузка страницы справочника…</p>';

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const bytes = await response.arrayBuffer();
      const html = new TextDecoder('windows-1251').decode(bytes);
      const sourceDocument = new DOMParser().parseFromString(html, 'text/html');

      if (sourceDocument.title) document.title = `${sourceDocument.title} — CoilMaster`;

      const content = prepareContent(sourceDocument);
      host.replaceChildren(buildPageControls(), content);
      installBackToTop();
      document.dispatchEvent(new CustomEvent('handbook:content-loaded'));
    } catch (error) {
      host.innerHTML = '<p class="legacy-note">Не удалось открыть страницу справочника. Исходный файл не изменён; можно вернуться на главную и выбрать другую схему.</p>';
      console.error('Legacy handbook page loading failed:', error);
    }
  }

  loadPage();
})();
