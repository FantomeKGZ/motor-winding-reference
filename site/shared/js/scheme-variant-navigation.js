(() => {
  'use strict';

  const current = window.location.pathname.split('/').filter(Boolean)
    .find((part) => part === 'desktop' || part === 'mobile');
  if (!current) return;

  const sourceRoot = current === 'desktop'
    ? '../../sourse/desktop/Справочник от 09.12.2024 HTML/'
    : '../../sourse/mobile/Справочник от 09.12.2024 для мобильных устройств HTML/';
  const cache = new Map();

  if (!document.querySelector('link[href$="scheme-variant-navigation.css"]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = '../shared/css/scheme-variant-navigation.css';
    document.head.appendChild(style);
  }

  function normalize(value) {
    return String(value || '')
      .toLocaleLowerCase('ru-RU')
      .replace(/ё/g, 'е')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizePath(value) {
    return String(value || '').replace(/^\.\//, '').replace(/^\/+/, '');
  }

  function windingTypes(text) {
    const source = normalize(text);
    const result = [];
    const rules = [
      ['двухслойная', /двухслойн/],
      ['однослойная', /однослойн/],
      ['цепная', /цепн/],
      ['вразвалку', /вразвалк/],
      ['расширенная фазная зона', /расширенн[^.]{0,40}фазн[^.]{0,30}зон/],
      ['сплошная фазная зона', /сплошн[^.]{0,30}фазн[^.]{0,30}зон/],
    ];
    rules.forEach(([label, pattern]) => {
      if (pattern.test(source)) result.push(label);
    });
    return result;
  }

  function normalizeWantedType(value) {
    const source = normalize(value);
    if (!source) return null;
    if (source.includes('двухслойн')) return 'двухслойная';
    if (source.includes('однослойн')) return 'однослойная';
    if (source.includes('цепн')) return 'цепная';
    if (source.includes('вразвалк')) return 'вразвалку';
    if (source.includes('расшир') && source.includes('фаз')) return 'расширенная фазная зона';
    if (source.includes('сплош') && source.includes('фаз')) return 'сплошная фазная зона';
    return source;
  }

  function extractPitch(text) {
    const match = String(text || '').match(/[уy]\s*=\s*([0-9]+(?:\s*[;,+\-/]\s*[0-9]+)*)/iu);
    return match ? match[1].replace(/\s+/g, '') : null;
  }

  function extractBranches(text) {
    const values = new Set();
    for (const match of String(text || '').matchAll(/[аa]\s*=\s*(\d+)/giu)) {
      values.add(Number(match[1]));
    }
    return Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  }

  function connectionTargets(paragraph) {
    const values = [];
    paragraph.querySelectorAll('a[href]').forEach((anchor) => {
      const href = normalizePath(anchor.getAttribute('href'));
      if (/^ss.*\.html?$/i.test(href) && !values.includes(href)) values.push(href);
    });
    return values;
  }

  function markerHints(paragraph) {
    return Array.from(paragraph.querySelectorAll('img[title]'))
      .map((image) => (image.getAttribute('title') || '').trim())
      .filter(Boolean);
  }

  function findFollowingImage(paragraph) {
    let node = paragraph.nextElementSibling;
    for (let step = 0; node && step < 3; step += 1, node = node.nextElementSibling) {
      if (node.tagName === 'HR') break;
      const image = node.matches('img') ? node : node.querySelector('img');
      if (!image) continue;
      const anchor = image.closest('a[href]');
      return {
        src: normalizePath(image.getAttribute('src')),
        href: normalizePath(anchor?.getAttribute('href') || image.getAttribute('src')),
      };
    }
    return null;
  }

  function sectionTitleFor(paragraph) {
    let node = paragraph.previousElementSibling;
    for (let step = 0; node && step < 8; step += 1, node = node.previousElementSibling) {
      if (node.tagName === 'HR') continue;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (node.querySelector('b, strong') || /^обмотки/i.test(text)) return text;
      if (node.tagName === 'P' && !/схема укладки/i.test(text)) return text;
    }
    return '';
  }

  function extractVariants(doc, target) {
    const variants = [];
    const seen = new Set();
    doc.querySelectorAll('p').forEach((paragraph, index) => {
      const description = (paragraph.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/схема\s+укладки/i.test(description)) return;
      const image = findFollowingImage(paragraph);
      if (!image?.src) return;
      const key = `${target}|${image.src}`;
      if (seen.has(key)) return;
      seen.add(key);

      variants.push({
        id: `${target}#variant-${index + 1}`,
        target,
        image: image.src,
        imageHref: image.href,
        description,
        section: sectionTitleFor(paragraph),
        windingTypes: windingTypes(description),
        pitch: extractPitch(description),
        parallelBranches: extractBranches(description),
        connections: connectionTargets(paragraph),
        hints: markerHints(paragraph),
      });
    });
    return variants;
  }

  async function inspectPage(target) {
    if (cache.has(target)) return cache.get(target);
    const promise = (async () => {
      const url = new URL(`${sourceRoot}${target}`, window.location.href);
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const html = new TextDecoder('windows-1251').decode(bytes);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return extractVariants(doc, target);
    })().catch((error) => {
      console.warn('Unable to inspect winding variants:', target, error);
      return [];
    });
    cache.set(target, promise);
    return promise;
  }

  function matchesMotor(variant, motor) {
    const wantedType = normalizeWantedType(motor?.winding_type);
    if (wantedType && variant.windingTypes.length && !variant.windingTypes.includes(wantedType)) return false;

    const wantedBranches = motor?.parallel_branches == null ? null : Number(motor.parallel_branches);
    if (Number.isFinite(wantedBranches) && variant.parallelBranches.length && !variant.parallelBranches.includes(wantedBranches)) return false;

    const wantedPitch = normalize(motor?.winding_pitch ?? motor?.coil_pitch ?? motor?.pitch ?? motor?.y);
    if (wantedPitch && variant.pitch && normalize(variant.pitch) !== wantedPitch.replace(/^y\s*=\s*/i, '').replace(/^у\s*=\s*/i, '')) return false;

    return true;
  }

  function variantUrl(variant) {
    const url = new URL('page.html', window.location.href);
    url.searchParams.set('src', variant.target);
    url.searchParams.set('from', 'home');
    url.searchParams.set('img', variant.image);
    return `${url.pathname.split('/').pop()}${url.search}`;
  }

  function variantCard(variant) {
    const item = document.createElement('li');
    item.className = 'cm-scheme-variant';

    const link = document.createElement('a');
    link.href = variantUrl(variant);
    link.className = 'cm-scheme-variant-link';
    link.textContent = variant.description;

    const meta = document.createElement('div');
    meta.className = 'cm-scheme-variant-meta';
    const parts = [];
    if (variant.pitch) parts.push(`y=${variant.pitch}`);
    if (variant.parallelBranches.length) parts.push(`a=${variant.parallelBranches.join(', ')}`);
    if (variant.windingTypes.length) parts.push(variant.windingTypes.join(', '));
    if (variant.connections.length) parts.push(`схем соединения: ${variant.connections.length}`);
    meta.textContent = parts.join(' · ');

    item.append(link);
    if (variant.section) {
      const section = document.createElement('small');
      section.className = 'cm-scheme-variant-section';
      section.textContent = variant.section;
      item.append(section);
    }
    if (meta.textContent) item.append(meta);
    if (variant.hints.length) {
      const hint = document.createElement('small');
      hint.className = 'cm-scheme-variant-hint';
      hint.textContent = variant.hints.join(' · ');
      item.append(hint);
    }
    return item;
  }

  async function renderVariants(detail) {
    const panel = document.querySelector('[data-esp32-match-panel]');
    if (!panel || !Array.isArray(detail?.matches) || !detail.matches.length) return;
    panel.querySelector('[data-scheme-variants]')?.remove();

    const motor = detail.context?.payload?.motor || {};
    const pages = await Promise.all(detail.matches.map(async (entry) => ({
      entry,
      variants: await inspectPage(entry.link.target),
    })));
    const all = pages.flatMap((page) => page.variants);
    const filtered = all.filter((variant) => matchesMotor(variant, motor));

    const section = document.createElement('section');
    section.className = 'cm-scheme-variants';
    section.dataset.schemeVariants = '';

    const heading = document.createElement('strong');
    heading.textContent = 'Варианты укладки внутри найденных страниц';
    const summary = document.createElement('p');
    summary.textContent = filtered.length === all.length
      ? `Найдено отдельных вариантов укладки: ${all.length}.`
      : `Найдено вариантов: ${all.length}; после параметров двигателя осталось: ${filtered.length}.`;
    section.append(heading, summary);

    if (!all.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Отдельные рисунки на найденных страницах автоматически не распознаны. Откройте страницу целиком.';
      section.appendChild(empty);
    } else if (!filtered.length) {
      const empty = document.createElement('p');
      empty.textContent = 'На уровне отдельных рисунков точного совпадения не найдено. Страница-группа остаётся доступной для ручной проверки.';
      section.appendChild(empty);
    } else {
      const list = document.createElement('ol');
      list.className = 'cm-scheme-variant-list';
      filtered.slice(0, 20).forEach((variant) => list.appendChild(variantCard(variant)));
      section.appendChild(list);
      if (filtered.length > 20) {
        const more = document.createElement('small');
        more.textContent = `Показаны первые 20 из ${filtered.length} вариантов.`;
        section.appendChild(more);
      }
    }

    panel.appendChild(section);
    window.CoilMasterSchemeVariants = { motor, all, filtered };
    document.dispatchEvent(new CustomEvent('coilmaster:scheme-variants', { detail: window.CoilMasterSchemeVariants }));
  }

  function highlightRequestedImage() {
    if (!/\/page\.html$/i.test(window.location.pathname)) return;
    const requested = normalizePath(new URLSearchParams(window.location.search).get('img'));
    if (!requested) return;
    const root = document.querySelector('.original-page-content');
    if (!root) return;

    const image = Array.from(root.querySelectorAll('img[src]')).find((node) => {
      try {
        const url = new URL(node.src, window.location.href);
        return decodeURIComponent(url.pathname).replace(/\\/g, '/').endsWith(requested);
      } catch {
        return normalizePath(node.getAttribute('src')).endsWith(requested);
      }
    });
    if (!image) return;

    const target = image.closest('p, div, table') || image;
    target.classList.add('cm-scheme-variant-target');
    requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }));
  }

  document.addEventListener('coilmaster:esp32-match-result', (event) => renderVariants(event.detail));
  document.addEventListener('handbook:content-loaded', highlightRequestedImage);

  if (window.CoilMasterEsp32MatchResult) renderVariants(window.CoilMasterEsp32MatchResult);
  highlightRequestedImage();
})();
