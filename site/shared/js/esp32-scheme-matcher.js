(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  if (params.get('esp32test') !== '1') return;

  const current = window.location.pathname.split('/').filter(Boolean)
    .find((part) => part === 'desktop' || part === 'mobile');
  if (!current || !/\/index\.html$/i.test(window.location.pathname)) return;

  const MOCK_URL = '../shared/data/esp32-mock.json';

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

    // In the original handbook the slot count is normally the first numeric
    // value of the row. We keep this as a hint only and never invent a value.
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

    // Pole count is intentionally only a weak secondary hint. The original
    // homepage is organised primarily by slot count and speed.
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

  function makePanel(mock, liveLinks, testResults) {
    const panel = document.createElement('section');
    panel.className = 'legacy-note';
    panel.dataset.esp32Test = '';

    const heading = document.createElement('strong');
    heading.textContent = 'Тест сопоставления ESP32 → справочник';
    panel.appendChild(heading);

    const summary = document.createElement('p');
    const passed = testResults.filter((item) => item.matches.length > 0).length;
    summary.textContent = `Проверено ссылок: ${liveLinks.length}. Контрольных наборов: ${testResults.length}. С результатом: ${passed}.`;
    panel.appendChild(summary);

    testResults.forEach((result) => {
      const block = document.createElement('div');
      block.className = 'cm-esp32-test-case';

      const title = document.createElement('strong');
      title.textContent = `${result.motor.slots ?? '—'} пазов / ${result.motor.rpm ?? '—'} об/мин`;
      block.appendChild(title);

      const status = document.createElement('p');
      status.textContent = result.matches.length
        ? `Найдено кандидатов: ${result.matches.length}. Автоматический выбор не выполняется.`
        : 'Подходящих страниц не найдено. Ничего автоматически не выбрано.';
      block.appendChild(status);

      if (result.matches.length) block.appendChild(resultList(result.matches));
      panel.appendChild(block);
    });

    const warning = document.createElement('p');
    warning.textContent = 'Это проверка навигации по существующей таблице. Совпадение по пазам и оборотам ещё не означает, что конкретный вариант укладки подходит двигателю.';
    panel.appendChild(warning);

    return panel;
  }

  async function run() {
    const host = document.querySelector('.legacy-content');
    if (!host || host.querySelector('[data-esp32-test]')) return;

    const liveLinks = collectLiveLinks();
    if (!liveLinks.length) return;

    try {
      const mockResponse = await fetch(MOCK_URL);
      if (!mockResponse.ok) throw new Error(`mock HTTP ${mockResponse.status}`);

      const mock = await mockResponse.json();
      const testCases = Array.isArray(mock.test_cases) && mock.test_cases.length
        ? mock.test_cases
        : [mock.motor || {}];

      const testResults = testCases.map((motor) => ({ motor, matches: findMatches(liveLinks, motor) }));
      host.prepend(makePanel(mock, liveLinks, testResults));

      window.CoilMasterEsp32TestResult = {
        mock,
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
