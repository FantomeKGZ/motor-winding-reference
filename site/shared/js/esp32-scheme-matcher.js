(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  if (params.get('esp32test') !== '1') return;

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
        href: anchor.getAttribute('href') || '',
        text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
        rowText,
        slots,
        rpm,
        exists: true,
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

  function resultList(matches) {
    const list = document.createElement('ol');
    matches.slice(0, 10).forEach(({ link, score }) => {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = `page.html?src=${encodeURIComponent(link.target)}&from=home`;
      anchor.textContent = link.text || link.target;

      const meta = document.createElement('small');
      meta.textContent = ` — ${link.slots ?? '?'} пазов / ${link.rpm ?? '?'} об/мин, совпадение ${score}`;
      item.append(anchor, meta);
      list.appendChild(item);
    });
    return list;
  }

  function makePanel(mock, liveLinks, testResults, clientMeta) {
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
        : (result.matches.length ? `Найдено кандидатов: ${result.matches.length}. Автоматический выбор не выполняется.` : 'Ошибка: подходящих страниц не найдено.');
      block.appendChild(status);

      if (result.matches.length) block.appendChild(resultList(result.matches));
      panel.appendChild(block);
    });

    const warning = document.createElement('p');
    warning.textContent = 'Совпадение по пазам и оборотам определяет только группу схем. Конкретный вариант укладки выбирается после проверки остальных параметров обмотки.';
    panel.appendChild(warning);

    return panel;
  }

  async function run() {
    const host = document.querySelector('.legacy-content');
    if (!host || host.querySelector('[data-esp32-test]')) return;

    const liveLinks = collectLiveLinks();
    if (!liveLinks.length) return;

    const client = window.CoilMasterEsp32Client;
    if (!client) {
      console.warn('ESP32 client is unavailable');
      return;
    }

    try {
      const context = await client.getContext({ mode: 'mock' });
      const mock = context.payload;
      const testCases = Array.isArray(mock.test_cases) && mock.test_cases.length
        ? mock.test_cases
        : [mock.motor || {}];

      const testResults = testCases.map((motor) => {
        const matches = findMatches(liveLinks, motor);
        const expectNoMatches = motor.expect_matches === 0;
        const passed = expectNoMatches ? matches.length === 0 : matches.length > 0;
        return { motor, matches, expectNoMatches, passed };
      });

      host.prepend(makePanel(mock, liveLinks, testResults, context));

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

  document.addEventListener('handbook:content-loaded', run);
  run();
})();
