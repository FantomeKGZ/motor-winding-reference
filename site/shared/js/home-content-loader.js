(() => {
  'use strict';

  const current = window.location.pathname.split('/').filter(Boolean).find((part) => part === 'desktop' || part === 'mobile');
  const host = document.querySelector('.legacy-content');
  if (!current || !host) return;

  const sourceRoot = current === 'desktop'
    ? '../../sourse/desktop/Справочник от 09.12.2024 HTML/'
    : '../../sourse/mobile/Справочник от 09.12.2024 для мобильных устройств HTML/';
  const sourceUrl = new URL(`${sourceRoot}index.html`, window.location.href);

  function rewriteResourceUrls(root) {
    root.querySelectorAll('[href]').forEach((node) => {
      const value = node.getAttribute('href');
      if (!value || value.startsWith('#') || /^(?:https?:|mailto:|javascript:)/i.test(value)) return;
      node.href = new URL(value, sourceUrl).href;
    });

    root.querySelectorAll('[src]').forEach((node) => {
      const value = node.getAttribute('src');
      if (!value || /^(?:https?:|data:)/i.test(value)) return;
      node.src = new URL(value, sourceUrl).href;
    });
  }

  function prepareOriginalContent(sourceContent) {
    const wrapper = document.createElement('div');
    wrapper.className = 'original-home-content';
    wrapper.innerHTML = sourceContent.innerHTML;
    rewriteResourceUrls(wrapper);

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
    const loading = document.createElement('p');
    loading.className = 'legacy-note';
    loading.dataset.homeLoading = '';
    loading.textContent = 'Загрузка полной оригинальной главной страницы…';
    host.appendChild(loading);

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const bytes = await response.arrayBuffer();
      const html = new TextDecoder('windows-1251').decode(bytes);
      const sourceDocument = new DOMParser().parseFromString(html, 'text/html');
      const sourceContent = sourceDocument.querySelector('.content') || sourceDocument.body;
      const original = prepareOriginalContent(sourceContent);

      const temporary = host.querySelector('h2#schemes');
      if (temporary) {
        let node = temporary;
        while (node) {
          const next = node.nextSibling;
          node.remove();
          node = next;
        }
      }

      loading.remove();
      host.appendChild(original);
      document.dispatchEvent(new CustomEvent('handbook:content-loaded'));
    } catch (error) {
      loading.textContent = 'Не удалось загрузить полную оригинальную страницу. Временная таблица оставлена доступной.';
      console.error('Handbook home loading failed:', error);
    }
  }

  loadOriginalHome();
})();
