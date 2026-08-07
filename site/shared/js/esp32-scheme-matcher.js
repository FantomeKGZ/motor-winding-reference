(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  if (params.get('esp32test') !== '1') return;

  const current = window.location.pathname.split('/').filter(Boolean)
    .find((part) => part === 'desktop' || part === 'mobile');
  if (!current || !/\/index\.html$/i.test(window.location.pathname)) return;

  const MOCK_URL = '../shared/data/esp32-mock.json';

  function numbers(value) {
    return (String(value || '').match(/\d+/g) || []).map(Number);
  }

  function targetFromAnchor(anchor) {
    try {
      const url = new URL(anchor.href, window.location.href);
      if (/\/page\.html$/i.test(url.pathname)) {
        return (url.searchParams.get('src') || '').replace(/^\/+/, '');
      }
      return '';
    } catch {
      return '';
    }
  }

  function collectLiveLinks() {
    const links = [];
    const seen = new Set();

    document.querySelectorAll('.original-home-content a[href]').forEach((anchor) => {
      const target = targetFromAnchor(anchor);
      if (!target || !/\.html?$/i.test(target) || seen.has(target)) return;
      seen.add(target);
      links.push({
        target,
        href: anchor.getAttribute('href') || '',
        text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
        exists: true,
      });
    });

    return links;
  }

  function scoreLink(link, motor) {
    const text = `${link.text || ''} ${link.href || ''} ${link.target || ''}`;
    const nums = numbers(text);
    let score = 0;

    if (Number.isFinite(Number(motor.slots)) && nums.includes(Number(motor.slots))) score += 100;
    if (Number.isFinite(Number(motor.rpm)) && nums.includes(Number(motor.rpm))) score += 100;
    if (Number.isFinite(Number(motor.poles)) && nums.includes(Number(motor.poles))) score += 15;

    return score;
  }

  function makePanel(mock, matches, linkCount) {
    const panel = document.createElement('section');
    panel.className = 'legacy-note';
    panel.dataset.esp32Test = '';

    const heading = document.createElement('strong');
    heading.textContent = 'Тест сопоставления ESP32 → справочник';

    const motor = mock.motor || {};
    const summary = document.createElement('p');
    summary.textContent = `Тестовые данные: ${motor.slots ?? '—'} пазов, ${motor.rpm ?? '—'} об/мин, ${motor.phases ?? '—'} фазы. Проверено ссылок: ${linkCount}.`;

    panel.append(heading, summary);

    if (!matches.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Подходящих страниц по тестовым параметрам не найдено. Ничего автоматически не выбрано.';
      panel.appendChild(empty);
      return panel;
    }

    const note = document.createElement('p');
    note.textContent = `Найдено кандидатов: ${matches.length}. Автоматический выбор не выполняется.`;
    panel.appendChild(note);

    const list = document.createElement('ol');
    matches.slice(0, 10).forEach(({ link, score }) => {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = `page.html?src=${encodeURIComponent(link.target)}&from=home`;
      anchor.textContent = link.text || link.target;
      const meta = document.createElement('small');
      meta.textContent = ` — совпадение ${score}`;
      item.append(anchor, meta);
      list.appendChild(item);
    });
    panel.appendChild(list);

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
      const motor = mock.motor || {};
      const matches = liveLinks
        .map((link) => ({ link, score: scoreLink(link, motor) }))
        .filter((entry) => entry.score >= 200)
        .sort((a, b) => b.score - a.score || String(a.link.text || '').localeCompare(String(b.link.text || ''), 'ru'));

      host.prepend(makePanel(mock, matches, liveLinks.length));

      window.CoilMasterEsp32TestResult = { mock, matches, linkCount: liveLinks.length };
      document.dispatchEvent(new CustomEvent('coilmaster:esp32-test-result', { detail: window.CoilMasterEsp32TestResult }));
    } catch (error) {
      console.warn('ESP32 scheme matching test failed:', error);
    }
  }

  document.addEventListener('handbook:content-loaded', run);
  run();
})();
