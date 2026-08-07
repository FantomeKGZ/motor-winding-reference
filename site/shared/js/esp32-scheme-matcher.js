(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const TEST_MODE = params.get('esp32test') === '1';
  const current = window.location.pathname.split('/').filter(Boolean)
    .find((part) => part === 'desktop' || part === 'mobile');
  if (!current || !/\/index\.html$/i.test(window.location.pathname)) return;

  function numberTokens(value) {
    return (String(value || '').match(/\d+/g) || []).map(Number);
  }

  function decimalFrom(value) {
    if (value == null || value === '') return null;
    const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function nearlyEqual(a, b, tolerance = 0.002) {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
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
      const plausible = values.find((value) => value >= 6 && value <= 200);
      if (plausible != null) return plausible;
    }
    return null;
  }

  function anchorMetadata(anchor) {
    return `${anchor.getAttribute('title') || ''} ${anchor.textContent || ''}`.replace(/\s+/g, ' ').trim();
  }

  function inferLinkRpm(anchor) {
    const values = numberTokens(anchorMetadata(anchor));
    return values.find((value) => value >= 100 && value <= 10000) ?? null;
  }

  function inferLinkQ(anchor) {
    const metadata = anchorMetadata(anchor);
    const match = metadata.match(/(?:^|\s)q\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i);
    return match ? decimalFrom(match[1]) : null;
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
      const metadata = anchorMetadata(anchor);
      const key = `${target}|${slots ?? ''}|${rpm ?? ''}|${q ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);

      links.push({
        target,
        anchor,
        row,
        href: anchor.getAttribute('href') || '',
        text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
        title: anchor.getAttribute('title') || '',
        metadata,
        rowText,
        slots,
        rpm,
        q,
      });
    });

    return links;
  }

  function evaluateLink(link, motor) {
    const wantedSlots = Number(motor.slots);
    const wantedRpm = Number(motor.rpm);
    const wantedQ = decimalFrom(motor.q);

    if (!Number.isFinite(wantedSlots) || !Number.isFinite(wantedRpm)) {
      return { score: -1, baseMatch: false, qMatch: null };
    }

    if (link.slots !== wantedSlots || link.rpm !== wantedRpm) {
      return { score: -1, baseMatch: false, qMatch: null };
    }

    let score = 200;
    let qMatch = null;

    if (wantedQ != null && link.q != null) {
      qMatch = nearlyEqual(link.q, wantedQ);
      if (!qMatch) return { score: -1, baseMatch: true, qMatch: false };
      score += 40;
    }

    return { score, baseMatch: true, qMatch };
  }

  function findMatches(liveLinks, motor) {
    return liveLinks
      .map((link) => ({ link, ...evaluateLink(link, motor) }))
      .filter((entry) => entry.score >= 200)
      .sort((a, b) => b.score - a.score || String(a.link.title || a.link.target).localeCompare(String(b.link.title || b.link.target), 'ru'));
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
    matches.slice(0, 12).forEach(({ link, qMatch }) => {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = `page.html?src=${encodeURIComponent(link.target)}&from=home`;
      anchor.textContent = link.title || link.metadata || link.target;

      const parts = [`${link.slots ?? '?'} пазов`, `${link.rpm ?? '?'} об/мин`];
      if (link.q != null) parts.push(`q=${String(link.q).replace('.', ',')}`);
      if (qMatch === true) parts.push('q совпадает');

      const meta = document.createElement('small');
      meta.textContent = ` — ${parts.join(' · ')}`;
      item.append(anchor, meta);
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

    const qText = decimalFrom(motor.q) != null ? `, q=${String(motor.q).replace('.', ',')}` : '';
    const summary = document.createElement('p');
    summary.textContent = `${motor.model || 'Текущий двигатель'}: ${motor.slots ?? '—'} пазов, ${motor.rpm ?? '—'} об/мин${qText}. Найдено вариантов: ${matches.length}.`;

    panel.append(heading, summary);

    if (!Number.isFinite(Number(motor.slots)) || !Number.isFinite(Number(motor.rpm))) {
      const missing = document.createElement('p');
      missing.textContent = 'Для автоматического поиска группы ESP32 должна передать как минимум slots и rpm. Недостающие значения сайт не вычисляет самостоятельно.';
      panel.appendChild(missing);
    } else if (matches.length) {
      const note = document.createElement('p');
      note.textContent = decimalFrom(motor.q) != null
        ? 'Сначала выполнено точное совпадение по пазам и оборотам, затем применён дополнительный фильтр q там, где q указан в исходной ссылке.'
        : 'Подходящая группа определена по пазам и оборотам. Конкретный вариант укладки автоматически не выбирается.';
      panel.append(note, resultList(matches));

      const first = matches[0].link.anchor.closest('td, th') || matches[0].link.anchor;
      requestAnimationFrame(() => first.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }));
    } else {
      const empty = document.createElement('p');
      empty.textContent = decimalFrom(motor.q) != null
        ? 'Точного совпадения по пазам, оборотам и доступному значению q в исходной таблице не найдено.'
        : 'В исходной таблице не найдено точного совпадения по количеству пазов и оборотам.';
      panel.appendChild(empty);
    }

    host.prepend(panel);

    window.CoilMasterEsp32MatchResult = { context, matches };
    document.dispatchEvent(new CustomEvent('coilmaster:esp32-match-result', {
      detail: window.CoilMasterEsp32MatchResult,
    }));
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

      const qText = decimalFrom(result.motor.q) != null ? ` · q=${String(result.motor.q).replace('.', ',')}` : '';
      const title = document.createElement('strong');
      title.textContent = `${result.passed ? '✓' : '✕'} ${result.motor.slots ?? '—'} пазов / ${result.motor.rpm ?? '—'} об/мин${qText}`;
      block.appendChild(title);

      const status = document.createElement('p');
      status.textContent = result.passed
        ? `Проверка пройдена. Найдено кандидатов: ${result.matches.length}.`
        : `Проверка не пройдена. Найдено кандидатов: ${result.matches.length}; ожидалось ${result.expectedText}.`;
      block.appendChild(status);

      if (result.matches.length) block.appendChild(resultList(result.matches));
      panel.appendChild(block);
    });

    return panel;
  }

  function evaluateExpectation(motor, matchCount) {
    const expected = motor.expected && typeof motor.expected === 'object' ? motor.expected : {};
    const min = Number.isFinite(Number(expected.min_matches)) ? Number(expected.min_matches) : null;
    const max = Number.isFinite(Number(expected.max_matches)) ? Number(expected.max_matches) : null;

    const minOk = min == null || matchCount >= min;
    const maxOk = max == null || matchCount <= max;
    const expectedText = [
      min != null ? `не меньше ${min}` : '',
      max != null ? `не больше ${max}` : '',
    ].filter(Boolean).join(' и ') || 'хотя бы 1';

    return {
      passed: min == null && max == null ? matchCount > 0 : minOk && maxOk,
      expectedText,
    };
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
      const testResults = testCases.map((motor) => {
        const matches = findMatches(liveLinks, motor);
        const expectation = evaluateExpectation(motor, matches.length);
        return { motor, matches, ...expectation };
      });
      host.prepend(makeTestPanel(liveLinks, testResults, context));

      window.CoilMasterEsp32TestResult = {
        mock,
        client: context,
        linkCount: liveLinks.length,
        testResults,
      };
      document.dispatchEvent(new CustomEvent('coilmaster:esp32-test-result', {
        detail: window.CoilMasterEsp32TestResult,
      }));
    } catch (error) {
      console.warn('ESP32 scheme matching test failed:', error);
    }
  }

  function handleContext(context) {
    if (!context?.payload?.motor) return;
    const liveLinks = collectLiveLinks();
    if (!liveLinks.length) return;
    renderLiveMatch(context, findMatches(liveLinks, context.payload.motor));
  }

  document.addEventListener('coilmaster:esp32-context', (event) => handleContext(event.detail));
  document.addEventListener('handbook:content-loaded', () => {
    runTests();
    if (window.CoilMasterEsp32Context) handleContext(window.CoilMasterEsp32Context);
  });

  runTests();
})();
