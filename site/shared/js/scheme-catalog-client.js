(() => {
  'use strict';

  let catalogPromise = null;
  const legacyPageCache = new Map();
  const connectionCache = new Map();

  function interfaceName() {
    return window.location.pathname.includes('/mobile/') ? 'mobile' : 'desktop';
  }

  function catalogUrl() {
    return `../shared/data/${interfaceName()}-scheme-catalog.json`;
  }

  function sourceRoot() {
    return interfaceName() === 'mobile'
      ? '../../sourse/mobile/Справочник от 09.12.2024 для мобильных устройств HTML/'
      : '../../sourse/desktop/Справочник от 09.12.2024 HTML/';
  }

  function clean(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalized(value) {
    return clean(value).toLowerCase().replace(/ё/g, 'е');
  }

  function normalizePath(value) {
    const raw = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    try { return decodeURIComponent(raw); } catch { return raw; }
  }

  function isMarkerImagePath(value) {
    const path = normalizePath(value).toLowerCase();
    if (!path) return true;
    const base = path.split('/').pop() || '';
    return /^(?:met\d+|marker|icon|recommend)[^/]*\.(?:gif|jpe?g|png|webp)$/i.test(base);
  }

  async function fetchLegacyDocument(target) {
    const key = normalizePath(target || 'index.html');
    if (legacyPageCache.has(key)) return legacyPageCache.get(key);
    const promise = fetch(new URL(sourceRoot() + key, window.location.href), { cache: 'force-cache' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Legacy page unavailable: HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        const html = new TextDecoder('windows-1251').decode(bytes);
        return new DOMParser().parseFromString(html, 'text/html');
      });
    legacyPageCache.set(key, promise);
    return promise;
  }

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function stableId(prefix, ...parts) {
    const payload = new TextEncoder().encode(parts.join('|'));
    if (!window.crypto?.subtle) throw new Error('Web Crypto is required for deterministic scheme IDs');
    const digest = await window.crypto.subtle.digest('SHA-1', payload);
    return `${prefix}-${toHex(digest).slice(0, 12).toUpperCase()}`;
  }

  function windingTypes(text) {
    const source = normalized(text);
    const rules = [
      ['two_layer', /двухслойн/],
      ['single_layer', /однослойн/],
      ['chain', /цепн/],
      ['concentric', /вразвалк/],
      ['expanded_phase_zone', /расширенн.{0,40}фазн.{0,30}зон/],
      ['continuous_phase_zone', /сплошн.{0,30}фазн.{0,30}зон/],
      ['single_phase', /однофазн/],
      ['two_speed', /двухскорост/],
      ['three_speed', /трехскорост/],
      ['combined', /совмещенн|совмещённ/],
    ];
    return rules.filter(([, re]) => re.test(source)).map(([name]) => name);
  }

  function extractBranches(text) {
    const values = Array.from(String(text || '').matchAll(/[аa]\s*=\s*(\d+(?:\s*\/\s*\d+)?)/giu), (match) => match[1]);
    const numbers = [];
    values.forEach((value) => value.split('/').forEach((part) => {
      const number = Number(part.trim());
      if (Number.isFinite(number)) numbers.push(number);
    }));
    return Array.from(new Set(numbers)).sort((a, b) => a - b);
  }

  function phaseConnection(text) {
    const source = clean(text).replace(/△/g, 'Δ');
    const match = source.match(/соединени[ея]\s+фаз[^YΔ]{0,24}([YΔ]+(?:\s*\/\s*[YΔ]+)+|[YΔ]{1,12})/iu);
    return match ? match[1].replace(/\s+/g, '') : null;
  }

  function connectionKinds(text) {
    const source = normalized(text);
    const result = [];
    const isSupply = /подключени[ея].{0,80}(?:к\s+сети|электродвигател)/.test(source) || /электродвигател.{0,80}к\s+сети/.test(source);
    const isConnection = /схем[аы]\s+соединени/.test(source) || /соединени[ея]\s+обмот/.test(source);

    if (/однофазн/.test(source)) {
      if (isSupply || /подключени/.test(source)) result.push('single_phase_supply');
      else if (isConnection) result.push('single_phase_winding');
    }
    if (/двухскорост/.test(source)) {
      if (isSupply || /подключени/.test(source)) result.push('two_speed_supply');
      else if (isConnection) result.push('two_speed_winding');
    }
    if (/трехскорост/.test(source)) {
      if (isSupply || /подключени/.test(source)) result.push('three_speed_supply');
      else if (isConnection) result.push('three_speed_winding');
    }
    if (/совмещенн|совмещённ/.test(source) && isConnection) result.push('combined_winding');

    if (!result.length) {
      const starDelta = /звезд.{0,18}(?:и|\/|-)?.{0,8}треуг/.test(source);
      if (starDelta) {
        result.push('star_delta');
      } else {
        if (/в\s+звезд|соединени.{0,35}звезд/.test(source)) result.push('star');
        if (/в\s+треугольник|соединени.{0,35}треугольник/.test(source)) result.push('delta');
      }
      if (/даландер|dahlander/.test(source)) result.push('dahlander');
      if (/двойн.{0,10}звезд|\byy\b/.test(source)) result.push('double_star');
    }
    return Array.from(new Set(result));
  }

  function extractPitch(text) {
    const match = String(text || '').match(/[уy]\s*=\s*([0-9]+(?:\s*[;,+\-/]\s*[0-9]+)*)/iu);
    return match ? clean(match[1]).replace(/\s+/g, '') : null;
  }

  function tableValue(doc, labelPattern) {
    for (const row of doc.querySelectorAll('tr')) {
      const cells = Array.from(row.querySelectorAll('td,th')).map((cell) => clean(cell.textContent));
      if (!cells.some((value) => labelPattern.test(normalized(value)))) continue;
      for (let index = cells.length - 1; index >= 0; index -= 1) {
        const match = cells[index].match(/[-+]?\d+(?:[.,]\d+)?/);
        if (match) return Number(match[0].replace(',', '.'));
      }
    }
    return null;
  }

  function pageParameters(doc) {
    const text = clean(`${doc.title || ''} ${doc.body?.textContent || ''}`);
    const number = (re) => {
      const match = text.match(re);
      return match ? Number(match[1]) : null;
    };
    const qText = text.match(/\bq\s*=\s*([\d.,]+)/i);
    return {
      slots: tableValue(doc, /количеств.{0,12}паз|^z1$/) ?? number(/(?:количеств[оа]\s+пазов|пазов)[^0-9]{0,30}(\d+)/i),
      rpm: tableValue(doc, /частот.{0,20}вращ/) ?? number(/(\d{2,5})\s*об(?:\/|\.|\s)*мин/i),
      poles: tableValue(doc, /числ.{0,10}полюс|^2p$/) ?? number(/2p\s*=\s*(\d+)/i),
      q: tableValue(doc, /пазов.{0,30}полюс.{0,20}фаз|^q$/) ?? (qText ? Number(qText[1].replace(',', '.')) : null),
    };
  }

  function realImagesIn(node) {
    if (!node) return [];
    const images = node.matches?.('img[src]') ? [node] : Array.from(node.querySelectorAll?.('img[src]') || []);
    return images.filter((image) => !isMarkerImagePath(image.getAttribute('src')));
  }

  function firstRealImageIn(node) {
    return realImagesIn(node)[0] || null;
  }

  function findFollowingImage(paragraph) {
    const direct = firstRealImageIn(paragraph);
    if (direct) return direct;
    let node = paragraph.nextElementSibling;
    for (let step = 0; node && step < 4; step += 1, node = node.nextElementSibling) {
      const image = firstRealImageIn(node);
      if (image) return image;
    }
    return null;
  }

  function imagesForConnectionCaption(paragraphs, index) {
    const result = [];
    const seen = new Set();
    const add = (node) => realImagesIn(node).forEach((image) => {
      const path = normalizePath(image.getAttribute('src'));
      if (!path || seen.has(path)) return;
      seen.add(path);
      result.push(image);
    });

    add(paragraphs[index]);
    for (let offset = 1; offset <= 8 && index + offset < paragraphs.length; offset += 1) {
      const next = paragraphs[index + offset];
      const text = clean(next.textContent);
      const kinds = connectionKinds(text);
      if (kinds.length) break;
      if (text && /структурн.{0,20}схем|схем[аы]\s+(?:соединени|подключени)/i.test(normalized(text))) break;
      add(next);
      if (text && !/вариант\s*№?\s*\d+/i.test(text) && result.length) break;
    }
    return result;
  }

  async function inspectConnection(page) {
    page = normalizePath(page);
    if (connectionCache.has(page)) return connectionCache.get(page);

    const promise = (async () => {
      const doc = await fetchLegacyDocument(page);
      const pageId = await stableId('CM-CON-PAGE', page);
      const pageKinds = connectionKinds(`${doc.title || ''} ${doc.body?.textContent || ''}`);
      const imageOptions = [];
      const seen = new Set();
      const paragraphs = Array.from(doc.querySelectorAll('p'));

      for (let index = 0; index < paragraphs.length; index += 1) {
        const paragraph = paragraphs[index];
        const text = clean(paragraph.textContent);
        const kinds = connectionKinds(text);
        if (!kinds.length) continue;
        const images = imagesForConnectionCaption(paragraphs, index);
        if (!images.length) continue;

        const branches = extractBranches(text);
        const phases = phaseConnection(text);
        for (const image of images) {
          const imagePath = normalizePath(image.getAttribute('src'));
          if (!imagePath || isMarkerImagePath(imagePath)) continue;
          for (const kind of kinds) {
            const key = `${kind}|${imagePath}`;
            if (seen.has(key)) continue;
            seen.add(key);
            imageOptions.push({
              connection_id: await stableId('CM-CON', page, imagePath, kind),
              type: kind,
              image: imagePath,
              description: text,
              scope: 'image',
              page,
              page_id: pageId,
              parallel_branches: branches,
              phase_connection: phases,
            });
          }
        }
      }

      const options = [...imageOptions];
      const imageKinds = new Set(imageOptions.map((item) => item.type));
      for (const kind of pageKinds) {
        if (imageKinds.has(kind)) continue;
        options.push({
          connection_id: await stableId('CM-CON', page, '', kind),
          type: kind,
          image: null,
          description: clean(doc.title),
          scope: 'page',
          page,
          page_id: pageId,
          parallel_branches: extractBranches(doc.title),
          phase_connection: phaseConnection(doc.title),
        });
      }

      if (!options.length) {
        options.push({
          connection_id: await stableId('CM-CON', page, '', 'unknown'),
          type: null,
          image: null,
          description: clean(doc.title),
          scope: 'page',
          page,
          page_id: pageId,
          parallel_branches: extractBranches(doc.title),
          phase_connection: phaseConnection(doc.title),
        });
      }

      return {
        page,
        page_id: pageId,
        title: clean(doc.title),
        types: pageKinds,
        options,
      };
    })();

    connectionCache.set(page, promise);
    return promise;
  }

  async function variantsFromPage(target) {
    const doc = await fetchLegacyDocument(target);
    const params = pageParameters(doc);
    const variants = [];
    const seenImages = new Set();
    const paragraphs = Array.from(doc.querySelectorAll('p'));

    for (const paragraph of paragraphs) {
      const description = clean(paragraph.textContent);
      if (!normalized(description).includes('схема укладки')) continue;
      const imageNode = findFollowingImage(paragraph);
      const image = normalizePath(imageNode?.getAttribute('src'));
      if (!image || isMarkerImagePath(image) || seenImages.has(image)) continue;
      seenImages.add(image);

      const connectionPages = [];
      const seenPages = new Set();
      paragraph.querySelectorAll('a[href]').forEach((anchor) => {
        const href = normalizePath(anchor.getAttribute('href'));
        if (!/^ss.*\.html?$/i.test(href) || seenPages.has(href.toLowerCase())) return;
        seenPages.add(href.toLowerCase());
        connectionPages.push(href);
      });

      const connections = await Promise.all(connectionPages.map(inspectConnection));
      const connectionOptions = [];
      const seenIds = new Set();
      connections.forEach((pageInfo) => pageInfo.options.forEach((option) => {
        if (seenIds.has(option.connection_id)) return;
        seenIds.add(option.connection_id);
        connectionOptions.push(option);
      }));

      variants.push({
        scheme_id: await stableId('CM-SCH', normalizePath(target), image),
        legacy_page: normalizePath(target),
        image,
        description,
        ...params,
        winding_types: windingTypes(description),
        pitch: extractPitch(description),
        parallel_branches: extractBranches(description),
        connections,
        connection_count: connections.length,
        connection_options: connectionOptions,
        connection_option_count: connectionOptions.length,
        special: [],
      });
    }
    return variants;
  }

  function rowSlots(row) {
    const cells = Array.from(row.querySelectorAll('td, th'));
    for (const cell of cells.slice(0, 2)) {
      const match = clean(cell.textContent).match(/^\D*(\d{1,3})\b/);
      if (match) return Number(match[1]);
    }
    return null;
  }

  function anchorRpm(anchor) {
    const source = `${anchor.getAttribute('title') || ''} ${anchor.textContent || ''}`;
    const match = source.match(/(\d{2,5})\s*об(?:\/|\.|\s)*мин/i) || source.match(/\b(\d{3,5})\b/);
    return match ? Number(match[1]) : null;
  }

  async function legacyTargetsForMotor(motor) {
    const doc = await fetchLegacyDocument('index.html');
    const targets = [];
    const seen = new Set();
    doc.querySelectorAll('tr').forEach((row) => {
      const slots = rowSlots(row);
      if (motor?.slots != null && slots !== Number(motor.slots)) return;
      row.querySelectorAll('a[href]').forEach((anchor) => {
        const href = normalizePath(anchor.getAttribute('href'));
        if (!/\.html?$/i.test(href)) return;
        const rpm = anchorRpm(anchor);
        if (motor?.rpm != null && rpm !== Number(motor.rpm)) return;
        if (seen.has(href)) return;
        seen.add(href);
        targets.push(href);
      });
    });
    return targets;
  }

  async function buildRuntimeCatalog(motor = {}) {
    const targets = await legacyTargetsForMotor(motor);
    const pages = await Promise.all(targets.map(variantsFromPage));
    const catalog = {
      version: 3,
      runtime: true,
      source: 'legacy-html-fallback',
      schemes: pages.flat(),
      stats: {
        schemes: pages.reduce((sum, items) => sum + items.length, 0),
        pages_with_variants: pages.filter((items) => items.length).length,
      },
    };
    document.dispatchEvent(new CustomEvent('coilmaster:scheme-catalog-fallback', { detail: { catalog, motor, targets } }));
    return catalog;
  }

  async function loadCatalog(options = {}) {
    if (options.catalog) return options.catalog;
    if (!catalogPromise || options.reload) {
      catalogPromise = fetch(options.url || catalogUrl(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: options.reload ? 'no-store' : 'default',
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Scheme catalog unavailable: HTTP ${response.status}`);
        const catalog = await response.json();
        if (!catalog || !Array.isArray(catalog.schemes)) throw new Error('Invalid scheme catalog');
        window.CoilMasterSchemeCatalog = catalog;
        document.dispatchEvent(new CustomEvent('coilmaster:scheme-catalog-ready', { detail: { catalog, sourceUrl: response.url } }));
        return catalog;
      }).catch((error) => {
        catalogPromise = null;
        throw error;
      });
    }
    return catalogPromise;
  }

  function equalNumber(a, b, tolerance = 0) {
    if (a == null || b == null || a === '' || b === '') return true;
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tolerance;
  }

  function includesNormalized(values, expected) {
    if (expected == null || expected === '') return true;
    const needle = normalized(expected);
    return (values || []).some((value) => normalized(value) === needle);
  }

  function branchMatches(values, expected) {
    if (expected == null || expected === '') return true;
    const target = Number(expected);
    return Number.isFinite(target) && (values || []).some((value) => Number(value) === target);
  }

  function pitchMatches(value, expected) {
    if (expected == null || expected === '') return true;
    if (value == null || value === '') return true;
    return normalized(value).replace(/\s+/g, '') === normalized(expected).replace(/\s+/g, '');
  }

  function strictBaseMatch(scheme, motor) {
    if (motor?.slots != null && !equalNumber(scheme.slots, motor.slots)) return false;
    if (motor?.rpm != null && !equalNumber(scheme.rpm, motor.rpm)) return false;
    return true;
  }

  function refineMatch(scheme, motor) {
    if (motor?.q != null && scheme.q != null && !equalNumber(scheme.q, motor.q, 0.001)) return false;
    if (motor?.poles != null && scheme.poles != null && !equalNumber(scheme.poles, motor.poles)) return false;
    if (motor?.winding_type && scheme.winding_types?.length && !includesNormalized(scheme.winding_types, motor.winding_type)) return false;
    if (motor?.parallel_branches != null && scheme.parallel_branches?.length && !branchMatches(scheme.parallel_branches, motor.parallel_branches)) return false;
    if (motor?.winding_pitch != null && !pitchMatches(scheme.pitch, motor.winding_pitch)) return false;
    return true;
  }

  function candidatesFromCatalog(catalog, motor = {}) {
    const schemes = Array.isArray(catalog?.schemes) ? catalog.schemes : [];
    return schemes.filter((scheme) => strictBaseMatch(scheme, motor)).filter((scheme) => refineMatch(scheme, motor));
  }

  async function findCandidates(motor = {}, options = {}) {
    let catalog;
    try {
      catalog = await loadCatalog(options);
    } catch (catalogError) {
      if (options.allowLegacyFallback === false) throw catalogError;
      catalog = await buildRuntimeCatalog(motor);
      window.CoilMasterSchemeCatalog = catalog;
    }
    const candidates = candidatesFromCatalog(catalog, motor);
    document.dispatchEvent(new CustomEvent('coilmaster:scheme-candidates-ready', {
      detail: {
        motor,
        candidates,
        catalogVersion: catalog.version || null,
        runtimeFallback: Boolean(catalog.runtime),
      },
    }));
    return candidates;
  }

  async function getScheme(schemeId, options = {}) {
    if (!schemeId) return null;
    const catalog = options.catalog || window.CoilMasterSchemeCatalog || await loadCatalog(options);
    return catalog.schemes.find((item) => item.scheme_id === schemeId) || null;
  }

  async function getConnection(schemeId, connectionId, options = {}) {
    if (!connectionId) return null;
    const scheme = await getScheme(schemeId, options);
    return scheme?.connection_options?.find((item) => item.connection_id === connectionId) || null;
  }

  window.CoilMasterSchemeCatalogClient = Object.freeze({
    loadCatalog,
    findCandidates,
    getScheme,
    getConnection,
    candidatesFromCatalog,
    buildRuntimeCatalog,
  });
})();
