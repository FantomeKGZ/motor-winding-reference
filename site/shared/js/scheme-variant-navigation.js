(() => {
  'use strict';

  const current = window.location.pathname.split('/').filter(Boolean)
    .find((part) => part === 'desktop' || part === 'mobile');
  if (!current) return;

  const sourceRoot = current === 'desktop'
    ? '../../sourse/desktop/Справочник от 09.12.2024 HTML/'
    : '../../sourse/mobile/Справочник от 09.12.2024 для мобильных устройств HTML/';
  const cache = new Map();
  const connectionCache = new Map();

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

  function normalizeConnection(value) {
    const source = normalize(value).replace(/\s/g, '');
    if (!source) return null;
    if (source === 'y' || source.includes('звезд') || source.includes('star')) return 'star';
    if (source === 'd' || source === 'delta' || source === 'triangle' || source.includes('треуг') || source.includes('дельт') || source.includes('δ') || source.includes('∆') || source.includes('Δ')) return 'delta';
    if (source.includes('звезда/треуг') || source.includes('звезда-треуг')) return 'star-delta';
    return source;
  }

  function connectionLabel(value) {
    if (value === 'star') return 'звезда';
    if (value === 'delta') return 'треугольник';
    if (value === 'star-delta') return 'звезда/треугольник';
    return value;
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

  async function fetchLegacyDocument(target) {
    const url = new URL(`${sourceRoot}${target}`, window.location.href);
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const html = new TextDecoder('windows-1251').decode(bytes);
    return new DOMParser().parseFromString(html, 'text/html');
  }

  async function inspectPage(target) {
    if (cache.has(target)) return cache.get(target);
    const promise = fetchLegacyDocument(target)
      .then((doc) => extractVariants(doc, target))
      .catch((error) => {
        console.warn('Unable to inspect winding variants:', target, error);
        return [];
      });
    cache.set(target, promise);
    return promise;
  }

  function inferConnectionKinds(text) {
    const source = normalize(text);
    const kinds = new Set();
    if (/в\s+звезд|соединени[^.]{0,30}звезд/.test(source)) kinds.add('star');
    if (/в\s+треугольник|соединени[^.]{0,30}треугольник/.test(source)) kinds.add('delta');
    return Array.from(kinds);
  }

  function extractConnectionImages(doc, target) {
    const items = [];
    const seen = new Set();
    doc.querySelectorAll('img[src]').forEach((image) => {
      const paragraph = image.closest('p');
      const previous = paragraph?.previousElementSibling;
      const context = [
        previous?.textContent || '',
        paragraph?.textContent || '',
        image.getAttribute('alt') || '',
        image.getAttribute('title') || '',
      ].join(' ');
      const kinds = inferConnectionKinds(context);
      if (!kinds.length) return;
      const src = normalizePath(image.getAttribute('src'));
      if (!src) return;
      for (const kind of kinds) {
        const key = `${kind}|${src}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          kind,
          target,
          image: src,
          description: (previous?.textContent || image.getAttribute('alt') || '').replace(/\s+/g, ' ').trim(),
        });
      }
    });
    return items;
  }

  async function inspectConnectionPage(target) {
    if (connectionCache.has(target)) return connectionCache.get(target);
    const promise = fetchLegacyDocument(target)
      .then((doc) => {
        const bodyText = doc.body?.textContent || '';
        const title = (doc.title || '').trim();
        const supported = inferConnectionKinds(`${title} ${bodyText}`);
        const images = extractConnectionImages(doc, target);
        images.forEach((item) => {
          if (!supported.includes(item.kind)) supported.push(item.kind);
        });
        return { target, title, supported, images };
      })
      .catch((error) => {
        console.warn('Unable to inspect connection page:', target, error);
        return { target, supported: [], images: [], error: error.message };
      });
    connectionCache.set(target, promise);
    return promise;
  }

  async function enrichVariantConnections(variant) {
    if (!variant.connections.length) return { ...variant, connectionMeta: [] };
    const connectionMeta = await Promise.all(variant.connections.map(inspectConnectionPage));
    return { ...variant, connectionMeta };
  }

  function variantSupportsConnection(variant, wanted) {
    if (!wanted || !variant.connectionMeta?.length) return true;
    if (wanted === 'star-delta') {
      const allKinds = new Set(variant.connectionMeta.flatMap((meta) => meta.supported || []));
      return allKinds.has('star') && allKinds.has('delta');
    }
    return variant.connectionMeta.some((meta) => (meta.supported || []).includes(wanted));
  }

  function matchesMotor(variant, motor) {
    const wantedType = normalizeWantedType(motor?.winding_type);
    if (wantedType && variant.windingTypes.length && !variant.windingTypes.includes(wantedType)) return false;

    const wantedBranches = motor?.parallel_branches == null ? null : Number(motor.parallel_branches);
    if (Number.isFinite(wantedBranches) && variant.parallelBranches.length && !variant.parallelBranches.includes(wantedBranches)) return false;

    const wantedPitch = normalize(motor?.winding_pitch ?? motor?.coil_pitch ?? motor?.pitch ?? motor?.y);
    if (wantedPitch && variant.pitch && normalize(variant.pitch) !== wantedPitch.replace(/^y\s*=\s*/i, '').replace(/^у\s*=\s*/i, '')) return false;

    const wantedConnection = normalizeConnection(motor?.connection);
    if (wantedConnection && !variantSupportsConnection(variant, wantedConnection)) return false;

    return true;
  }

  function pageUrl(target, image) {
    const url = new URL('page.html', window.location.href);
    url.searchParams.set('src', target);
    url.searchParams.set('from', 'home');
    if (image) url.searchParams.set('img', image);
    return `${url.pathname.split('/').pop()}${url.search}`;
  }

  function variantUrl(variant) {
    return pageUrl(variant.target, variant.image);
  }

  function bestConnectionLink(variant, wantedConnection) {
    if (!variant.connectionMeta?.length) return null;
    const wanted = normalizeConnection(wantedConnection);
    const candidates = variant.connectionMeta.flatMap((meta) => {
      const matchingImages = wanted
        ? meta.images.filter((image) => image.kind === wanted)
        : meta.images;
      if (matchingImages.length) return matchingImages.map((image) => ({ ...image, page: meta.target }));
      if (!wanted || meta.supported.includes(wanted)) return [{ kind: wanted, page: meta.target, image: null, description: meta.title }];
      return [];
    });
    return candidates[0] || null;
  }

  function variantCard(variant, motor) {
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

    const connection = bestConnectionLink(variant, motor?.connection);
    if (connection) {
      const connectionLink = document.createElement('a');
      connectionLink.className = 'cm-scheme-variant-connection';
      connectionLink.href = pageUrl(connection.page, connection.image);
      connectionLink.textContent = `Открыть схему соединения${connection.kind ? `: ${connectionLabel(connection.kind)}` : ''}`;
      item.append(connectionLink);
    }

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
    const raw = pages.flatMap((page) => page.variants);
    const all = await Promise.all(raw.map(enrichVariantConnections));
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

    if (motor.connection) {
      const connectionInfo = document.createElement('p');
      const normalized = normalizeConnection(motor.connection);
      connectionInfo.textContent = `Дополнительно проверено соединение: ${connectionLabel(normalized || motor.connection)}.`;
      section.appendChild(connectionInfo);
    }

    if (!all.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Отдельные рисунки на найденных страницах автоматически не распознаны. Откройте страницу целиком.';
      section.appendChild(empty);
    } else if (!filtered.length) {
      const empty = document.createElement('p');
      empty.textContent = 'На уровне отдельных рисунков и схем соединений точного совпадения не найдено. Страница-группа остаётся доступной для ручной проверки.';
      section.appendChild(empty);
    } else {
      const list = document.createElement('ol');
      list.className = 'cm-scheme-variant-list';
      filtered.slice(0, 20).forEach((variant) => list.appendChild(variantCard(variant, motor)));
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