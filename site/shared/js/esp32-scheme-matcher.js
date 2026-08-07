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

  function inferLinkRpm(anchor) {
    const values = numberTokens(anchor.textContent);
    return values.find((value) => value >= 100 && value <= 10000) ?? null;
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
      const rowText = (row?.textContent || '').replace(/\s+/g, ' ').trim();
      const key = `${target}|${slots ?? ''}|${rpm ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);

      links.push({
        target,
        anchor,
        row,
        href: anchor.getAttribute('href') || '',
        text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
        rowText,
        slots,
        rpm,
      });
    });

    return links;
  }

  function scoreLink(link, motor) {
    const wantedSlots = Number(motor.slots);
    const wantedRpm = Number(motor.rpm);
    const wantedPoles = Number(motor.poles);
    let score = 0;

    if (Number.isFinite(wantedSlots) && link.slots === wantedSlots) score += 100;
    if (Number.isFinite(wantedRpm) && link.rpm === wantedRpm) score += 100;

    if (Number.isFinite(wantedPoles)) {
      const contextNumbers = numberTokens(`${link.rowText} ${link.text} ${link.target}`);
      if (contextNumbers.includes(wantedPoles)) score += 10;
    }

    return score;
  }

  function findMatches(liveLinks, motor) {
    return liveLinks
      .map((link) => ({ link, score: scoreLink(link, motor) }))
      .filter((entry) => entry.score >= 200)
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
    matches.slice(0, 12).forEach(({ link, score }) => {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = `page.html?src=${encodeURIComponent(link.target)}&from=home`;
      anchor.textContent = link.text || link.target;

      const meta = document.createElement('small');
      meta.textContent = ` — ${link.slots ?? '?'} пазов / ${link.rpm ?? '?'} об/мин`;
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

    const summary = document.createElement('p');
    summary.textContent = `${motor.model || 'Текущий двигатель'}: ${motor.slots ?? '—'} пазов, ${motor.rpm ?? '—'} об/мин. Найдено вариантов: ${matches.length}.`;

    panel.append(heading, summary);

    if (matches.length) {
      const note = document.createElement('p');
      note.textContent = matches.length === 1
        ? 'Найдена одна группа по пазам и оборотам. Перед применением всё равно проверьте параметры обмотки.'
        : 'Подходящая группа подсвечена в исходной таблице. Конкретный вариант укладки автоматически не выбирается.';
      panel.append(note, resultList(matches));

      const first = matches[0].link.anchor.closest('td, th') || matches[0].link.anchor;
      requestAnimationFrame(() => first.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }));
    } else {
      const empty = document.createElement('p');
      empty.textContent = 'В исходной таблице не найдено точного совпадения по количеству пазов и оборотам.';
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

      const title = document.createElement('strong');
      title.textContent = `${result.passed ? '✓' : '✕'} ${result.motor.slots ?? '—'} пазов / ${result.motor.rpm ?? '—'} об/мин`;
      block.appendChild(title);

      const status = document.createElement('p');
      status.textContent = result.expectNoMatches
        ? (result.matches.length ? `Ошибка: найдено кандидатов ${result.matches.length}, ожидалось 0.` : 'Проверка пройдена: ложных совпадений нет.')
        : (result.matches.length ? `Найдено кандидатов: ${result.matches.length}.` : 'Ошибка: подходящих страниц не найдено.');
      block.appendChild(status);

      if (result.matches.length) block.appendChild(resultList(result.matches));
      panel.appendChild(block);
    });

    return panel;
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
        const expectNoMatches = motor.expect_matches === 0;
        return { motor, matches, expectNoMatches, passed: expectNoMatches ? matches.length === 0 : matches.length > 0 };
      });
      host.prepend(makeTestPanel(liveLinks, testResults, context));
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
