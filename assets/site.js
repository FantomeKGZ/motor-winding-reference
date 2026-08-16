(() => {
  'use strict';

  const SOURCE_INDEX = 'reference/index.html';
  const MAX_RENDERED = 120;
  const searchInput = document.querySelector('#reference-search');
  const results = document.querySelector('#search-results');
  const meta = document.querySelector('#search-meta');
  const reloadButton = document.querySelector('#reload-catalog');

  let catalogue = [];

  function normalize(value) {
    return String(value || '')
      .toLocaleLowerCase('ru-RU')
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function displayName(anchor, href) {
    const title = (anchor.getAttribute('title') || '').trim();
    const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
    if (title) return title;
    if (text && text.length > 1) return text;
    return href.replace(/\.html?$/i, '').replace(/[-_]/g, ' ');
  }

  function isPageHref(href) {
    if (!href) return false;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#')) return false;
    if (/^(?:https?:|mailto:|tel:|javascript:)/i.test(trimmed)) return false;
    if (/\.(?:jpe?g|png|gif|webp|svg|ico|pdf|zip|rar)$/i.test(trimmed)) return false;
    return /\.html?(?:[#?].*)?$/i.test(trimmed);
  }

  async function fetchWindows1251(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.arrayBuffer();
    return new TextDecoder('windows-1251').decode(data);
  }

  function extractCatalogue(html) {
    const documentFromSource = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set();
    const items = [];

    for (const anchor of documentFromSource.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href');
      if (!isPageHref(href)) continue;

      const cleanHref = href.split('#')[0];
      if (!cleanHref || seen.has(cleanHref)) continue;
      seen.add(cleanHref);

      const title = displayName(anchor, cleanHref);
      items.push({
        href: `reference/${cleanHref}`,
        sourceHref: cleanHref,
        title,
        haystack: normalize(`${title} ${cleanHref}`)
      });
    }

    return items;
  }

  function render(query = '') {
    if (!results || !meta) return;
    const terms = normalize(query).split(' ').filter(Boolean);
    const filtered = terms.length
      ? catalogue.filter(item => terms.every(term => item.haystack.includes(term)))
      : catalogue;

    results.replaceChildren();
    meta.textContent = catalogue.length
      ? `Найдено ${filtered.length} из ${catalogue.length} страниц справочника. Показано до ${MAX_RENDERED}.`
      : 'Каталог ещё не загружен.';

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Совпадений нет. Попробуйте номер пазов, обороты, тип двигателя или обозначение.';
      results.append(empty);
      return;
    }

    for (const item of filtered.slice(0, MAX_RENDERED)) {
      const link = document.createElement('a');
      link.className = 'result';
      link.href = item.href;

      const title = document.createElement('span');
      title.className = 'result-title';
      title.textContent = item.title;

      const path = document.createElement('span');
      path.className = 'result-path';
      path.textContent = item.sourceHref;

      link.append(title, path);
      results.append(link);
    }
  }

  async function loadCatalogue() {
    if (!meta) return;
    meta.textContent = 'Загрузка каталога из полного справочника…';
    if (reloadButton) reloadButton.disabled = true;

    try {
      const html = await fetchWindows1251(SOURCE_INDEX);
      catalogue = extractCatalogue(html);
      render(searchInput ? searchInput.value : '');
    } catch (error) {
      catalogue = [];
      results?.replaceChildren();
      meta.textContent = 'Автопоиск недоступен при этом способе открытия. Полный справочник ниже остаётся доступен напрямую.';
      const fallback = document.createElement('a');
      fallback.className = 'result';
      fallback.href = SOURCE_INDEX;
      fallback.innerHTML = '<span class="result-title">Открыть полный справочник</span><span class="result-path">reference/index.html</span>';
      results?.append(fallback);
      console.warn('Reference catalogue could not be loaded:', error);
    } finally {
      if (reloadButton) reloadButton.disabled = false;
    }
  }

  searchInput?.addEventListener('input', event => render(event.target.value));
  reloadButton?.addEventListener('click', loadCatalogue);
  loadCatalogue();
})();
