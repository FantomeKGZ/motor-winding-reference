(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const TEST_MODE = params.get('esp32test') === '1';
  const current = window.location.pathname.split('/').filter(Boolean)
    .find((part) => part === 'desktop' || part === 'mobile');
  if (!current || !/\/index\.html$/i.test(window.location.pathname)) return;

  const sourceRoot = current === 'desktop'
    ? '../../sourse/desktop/Справочник от 09.12.2024 HTML/'
    : '../../sourse/mobile/Справочник от 09.12.2024 для мобильных устройств HTML/';
  const candidateCache = new Map();

  function numberTokens(value) {
    return (String(value || '').match(/\d+(?:[.,]\d+)?/g) || [])
      .map((item) => Number(item.replace(',', '.')))
      .filter(Number.isFinite);
  }

  function normalizeText(value) {
    return String(value || '')
      .toLocaleLowerCase('ru-RU')
      .replace(/ё/g, 'е')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function targetFromAnchor(anchor) {
    try {
      const url = new URL(anchor.href, window.location.href);
      if (!/\/page\.html$/i.test(url.pathname)) return '';
      return (url.searchParams.get('src') || '').replace(/^\/+/, '');
    } catch {
      return '';
    }
  }

  function inferRowSlots(row) {
    const cells = Array.from(row?.querySelectorAll('th, td') || []);
    if (!cells.length) return null;
    for (const cell of cells.slice(0, 2)) {
      const values = numberTokens(cell.textContent);
      const plausible = values.find((value) => Number.isInteger(value) && value >= 6 && value <= 200);
      if (plausible != null) return plausible;
    }
    return null;
  }

  function inferLinkRpm(anchor) {
    const values = numberTokens(`${anchor.title || ''} ${anchor.textContent || ''}`);
    return values.find((value) => Number.isInteger(value) && value >= 100 && value <= 10000) ?? null;
  }

  function inferLinkQ(anchor) {
    const source = `${anchor.title || ''} ${anchor.textContent || ''}`;
    const match = source.match(/(?:^|\s)q\s*=\s*([\d.,]+)/i);
    return match ? Number(match[1].replace(',', '.')) : null;
  }

  function collectLiveLinks() {
    const links = [];
    const seen = new Set();

    document.querySelectorAll('.original-home-content a[href]').forEach((anchor) => {
      const target = targetFromAnchor(anchor);
      if (!target || !/\.html?$/i.test(target)) return;

      const row = anchor.closest('tr');
      const slots = inferRowSlots(row);
      const rpm = inferLinkRpm(anchor);
      const q = inferLinkQ(anchor);
      const rowText = (row?.textContent || '').replace(/\s+/g, ' ').trim();
      const key = `${target}|${slots ?? ''}|${rpm ?? ''}|${q ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);

      links.push({
        target,
        anchor,
        row,
        href: anchor.getAttribute('href') || '',
        text: (anchor.title || anchor.textContent || '').replace(/\s+/g, ' ').trim(),
        rowText,
        slots,
        rpm,
        q,
      });
    });

    return links;
  }

  function closeNumber(a, b, tolerance = 0.015) {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
  }

  function scoreLink(link, motor) {
    const wantedSlots = Number(motor.slots);
    const wantedRpm = Number(motor.rpm);
    const wantedQ = motor.q == null ? null : Number(motor.q);
    let score = 0;

    if (Number.isFinite(wantedSlots) && link.slots === wantedSlots) score += 100;
    if (Number.isFinite(wantedRpm) && link.rpm === wantedRpm) score += 100;

    if (Number.isFinite(wantedQ)) {
      if (Number.isFinite(link.q) && closeNumber(link.q, wantedQ)) score += 30;
      else if (Number.isFinite(link.q)) return -1;
    }

    return score;
  }

  function findBaseMatches(liveLinks, motor) {
    return liveLinks
      .map((link) => ({ link, score: scoreLink(link, motor), meta: null }))
      .filter((entry) => entry.score >= 200)
      .sort((a, b) => b.score - a.score || String(a.link.text || '').localeCompare(String(b.link.text || ''), 'ru'));
  }

  function extractTableValue(documentNode, aliases) {
    const wanted = aliases.map(normalizeText);
    for (const row of documentNode.querySelectorAll('table tr')) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (cells.length < 2) continue;
      const values = cells.map((cell) => cell.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const normalized = values.map(normalizeText);
      if (!normalized.some((value) => wanted.some((alias) => value.includes(alias)))) continue;
      const candidates = values.filter((value) => !wanted.some((alias) => normalizeText(value).includes(alias)));
      const numeric = [...candidates].reverse().find((value) => /\d/.test(value));
      return numeric || candidates[candidates.length - 1] || null;
    }
    return null;
  }

  function detectWindingTypes(text) {
    const source = normalizeText(text);
    const types = [];
    const rules = [
      ['двухслойная', /двухслойн/],
      ['однослойная', /однослойн/],
      ['цепная', /цепн/],
      ['вразвалку', /вразвалк/],
      ['расширенная фазная зона', /расширенн[^.]{0,30}фазн[^.]{0,20}зон/],
      ['сплошная фазная зона', /сплошн[^.]{0,25}фазн[^.]{0,20}зон/],
    ];
    rules.forEach(([label, pattern]) => {
      if (pattern.test(source)) types.push(label);
    });
    return types;
  }

  function detectParallelBranches(text) {
    const values = new Set();
    const source = String(text || '');
    const patterns = [
      /(?:параллельн[^.]{0,60}?ветв[^.]{0,30}?|\bа\s*=)\s*([0-9]+(?:\s*[,;]\s*[0-9]+)*)/giu,
      /\bа\s*=\s*(\d+)/giu,
    ];
    patterns.forEach((pattern) => {
      for (const match of source.matchAll(pattern)) {
        (match[1].match(/\d+/g) || []).forEach((item) => values.add(Number(item)));
      }
    });
    return Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  }

  function detectConnectionHints(documentNode) {
    const hints = new Set();
    documentNode.querySelectorAll('a[href]').forEach((anchor) => {
      const href = (anchor.getAttribute('href') || '').toLowerCase();
      const text = normalizeText(`${anchor.title || ''} ${anchor.textContent || ''}`);
      if (/^ss.*\.html?$/i.test(href) || text.includes('схема соедин')) {
        hints.add(href || text);
      }
    });
    return Array.from(hints);
  }

  async function inspectCandidate(target) {
    if (candidateCache.has(target)) return candidateCache.get(target);

    const promise = (async () => {
      const url = new URL(`${sourceRoot}${target}`, window.location.href);
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const html = new TextDecoder('windows-1251').decode(bytes);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const bodyText = doc.body?.textContent || '';
      const polesRaw = extractTableValue(doc, ['число полюсов', '2p']);
      const qRaw = extractTableValue(doc, ['число пазов на полюс и фазу', 'q']);
      return {
        target,
        title: (doc.title || '').trim(),
        poles: numberTokens(polesRaw)[0] ?? null,
        q: numberTokens(qRaw)[0] ?? null,
        windingTypes: detectWindingTypes(bodyText),
        parallelBranches: detectParallelBranches(bodyText),
        connectionHints: detectConnectionHints(doc),
      };
    })().catch((error) => ({ target, error: error.message }));

    candidateCache.set(target, promise);
    return promise;
  }

  function normalizeWindingType(value) {
    const text = normalizeText(value);
    if (!text) return null;
    if (text.includes('двухслойн')) return 'двухслойная';
    if (text.includes('однослойн')) return 'однослойная';
    if (text.includes('цепн')) return 'цепная';
    if (text.includes('вразвалк')) return 'вразвалку';
    if (text.includes('расшир') && text.includes('фаз')) return 'расширенная фазная зона';
    if (text.includes('сплош') && text.includes('фаз')) return 'сплошная фазная зона';
    return text;
  }

  function refineWithMeta(entry, motor) {
    const meta = entry.meta || {};
    let score = entry.score;
    const reasons = [];

    const wantedPoles = motor.poles == null ? null : Number(motor.poles);
    if (Number.isFinite(wantedPoles) && Number.isFinite(meta.poles)) {
      if (meta.poles !== wantedPoles) return null;
      score += 40;
      reasons.push(`2p=${meta.poles}`);
    }

    const wantedQ = motor.q == null ? null : Number(motor.q);
    if (Number.isFinite(wantedQ) && Number.isFinite(meta.q)) {
      if (!closeNumber(meta.q, wantedQ)) return null;
      score += 20;
      reasons.push(`q=${meta.q}`);
    }

    const wantedType = normalizeWindingType(motor.winding_type);
    if (wantedType && Array.isArray(meta.windingTypes) && meta.windingTypes.length) {
      if (!meta.windingTypes.includes(wantedType)) return null;
      score += 15;
      reasons.push(wantedType);
    }

    const wantedBranches = motor.parallel_branches == null ? null : Number(motor.parallel_branches);
    if (Number.isFinite(wantedBranches) && Array.isArray(meta.parallelBranches) && meta.parallelBranches.length) {
      if (!meta.parallelBranches.includes(wantedBranches)) return null;
      score += 10;
      reasons.push(`a=${wantedBranches}`);
    }

    return { ...entry, score, reasons };
  }

  async function findMatches(liveLinks, motor) {
    const base = findBaseMatches(liveLinks, motor);
    if (!base.length) return [];

    const inspected = await Promise.all(base.map(async (entry) => ({
      ...entry,
      meta: await inspectCandidate(entry.link.target),
    })));

    return inspected
      .map((entry) => refineWithMeta(entry, motor))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || String(a.link.text || '').localeCompare(String(b.link.text || ''), 'ru'));
  }

  function clearEsp32Highlights() {
    document.querySelectorAll('.cm-esp32-row-hit').forEach((node) => node.classList.remove('cm-esp32-row-hit'));
    document.querySelectorAll('.cm-esp32-cell-hit').forEach((node) => node.classList.remove('cm-esp32-cell-hit'));
    document.querySelector('[data-esp32-match-panel]')?.remove();
  }

  function highlightMatches(matches) {
    matches.forEach(({ link }) => {
      link.row?.classList.add('cm-esp32-row-hit');
      (link.anchor.closest('td, th') || link.anchor).classList.add('cm-esp32-cell-hit');
    });
  }

  function resultList(matches) {
    const list = document.createElement('ol');
    list.className = 'cm-esp32-match-list';
    matches.slice(0, 12).forEach(({ link, meta, reasons }) => {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = `page.html?src=${encodeURIComponent(link.target)}&from=home`;
      anchor.textContent = link.text || link.target;

      const details = [];
      details.push(`${link.slots ?? '?'} пазов / ${link.rpm ?? '?'} об/мин`);
      if (meta?.poles != null) details.push(`2p=${meta.poles}`);
      if (meta?.q != null) details.push(`q=${meta.q}`);
      if (reasons?.length) details.push(`проверено: ${reasons.join(', ')}`);

      const metaNode = document.createElement('small');
      metaNode.textContent = ` — ${details.join(' · ')}`;
      item.append(anchor, metaNode);
      list.appendChild(item);
    });
    return list;
  }

  function renderLiveMatch(context, matches) {
    clearEsp32Highlights();
    highlightMatches(matches);

    const host = document.querySelector('.legacy-content');
    if (!host) return;

    const motor = context?.payload?.motor || {};
    const panel = document.createElement('section');
    panel.className = 'legacy-note cm-esp32-match-panel';
    panel.dataset.esp32MatchPanel = '';

    const heading = document.createElement('strong');
    heading.textContent = 'ESP32 → подходящие схемы';

    const summary = document.createElement('p');
    summary.textContent = `${motor.model || 'Текущий двигатель'}: ${motor.slots ?? '—'} пазов, ${motor.rpm ?? '—'} об/мин. После проверки страниц найдено вариантов: ${matches.length}.`;
    panel.append(heading, summary);

    if (matches.length) {
      const note = document.createElement('p');
      note.textContent = 'Сайт проверил доступные параметры самих страниц схем. Конкретный рисунок укладки всё равно выбирает мастер, если на странице есть несколько вариантов.';
      panel.append(note, resultList(matches));
      const first = matches[0].link.anchor.closest('td, th') || matches[0].link.anchor;
      requestAnimationFrame(() => first.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }));
    } else {
      const empty = document.createElement('p');
      empty.textContent = 'После проверки параметров страниц подходящих кандидатов не осталось. Можно использовать обычный ручной поиск по таблице.';
      panel.appendChild(empty);
    }

    host.prepend(panel);
    window.CoilMasterEsp32MatchResult = { context, matches };
    document.dispatchEvent(new CustomEvent('coilmaster:esp32-match-result', { detail: window.CoilMasterEsp32MatchResult }));
  }

  function makeTestPanel(liveLinks, testResults, clientMeta) {
    const panel = document.createElement('section');
    panel.className = 'legacy-note';
    panel.dataset.esp32Test = '';
    const heading = document.createElement('strong');
    heading.textContent = 'Тест сопоставления ESP32 → справочник';
    panel.appendChild(heading);

    const source = document.createElement('p');
    source.textContent = `Источник данных: ${clientMeta.mode}. Получено: ${clientMeta.receivedAt}.`;
    panel.appendChild(source);

    const summary = document.createElement('p');
    const passed = testResults.filter((item) => item.passed).length;
    summary.textContent = `Проверено ссылок: ${liveLinks.length}. Тестов: ${testResults.length}. Успешно: ${passed}. Ошибок: ${testResults.length - passed}.`;
    panel.appendChild(summary);

    testResults.forEach((result) => {
      const block = document.createElement('div');
      block.className = 'cm-esp32-test-case';
      const title = document.createElement('strong');
      title.textContent = `${result.passed ? '✓' : '✕'} ${result.motor.slots ?? '—'} пазов / ${result.motor.rpm ?? '—'} об/мин`;
      block.appendChild(title);

      const status = document.createElement('p');
      const expected = result.motor.expected || {};
      status.textContent = `Найдено: ${result.matches.length}. Ожидание: ${expected.min_matches ?? 0}…${expected.max_matches ?? '∞'}.`;
      block.appendChild(status);
      if (result.matches.length) block.appendChild(resultList(result.matches));
      panel.appendChild(block);
    });
    return panel;
  }

  function expectationPassed(motor, matches) {
    const expected = motor.expected || {};
    const min = Number.isFinite(Number(expected.min_matches)) ? Number(expected.min_matches) : 0;
    const max = Number.isFinite(Number(expected.max_matches)) ? Number(expected.max_matches) : Infinity;
    return matches.length >= min && matches.length <= max;
  }

  async function runTests() {
    if (!TEST_MODE || document.querySelector('[data-esp32-test]')) return;
    const host = document.querySelector('.legacy-content');
    const liveLinks = collectLiveLinks();
    const client = window.CoilMasterEsp32Client;
    if (!host || !liveLinks.length || !client) return;

    try {
      const context = await client.getContext({ mode: 'mock' });
      const mock = context.payload;
      const testCases = Array.isArray(mock.test_cases) && mock.test_cases.length ? mock.test_cases : [mock.motor || {}];
      const testResults = [];
      for (const motor of testCases) {
        const matches = await findMatches(liveLinks, motor);
        testResults.push({ motor, matches, passed: expectationPassed(motor, matches) });
      }
      host.prepend(makeTestPanel(liveLinks, testResults, context));
      window.CoilMasterEsp32TestResult = { mock, client: context, linkCount: liveLinks.length, testResults };
    } catch (error) {
      console.warn('ESP32 scheme matching test failed:', error);
    }
  }

  async function handleContext(context) {
    if (!context?.payload?.motor) return;
    const liveLinks = collectLiveLinks();
    if (!liveLinks.length) return;
    const matches = await findMatches(liveLinks, context.payload.motor);
    renderLiveMatch(context, matches);
  }

  document.addEventListener('coilmaster:esp32-context', (event) => { handleContext(event.detail); });
  document.addEventListener('handbook:content-loaded', () => {
    runTests();
    if (window.CoilMasterEsp32Context) handleContext(window.CoilMasterEsp32Context);
  });

  runTests();
})();
