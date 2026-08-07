(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  if (params.get('esp32test') !== '1') return;

  const current = window.location.pathname.split('/').filter(Boolean)
    .find((part) => part === 'desktop' || part === 'mobile');
  if (!current || !/\/index\.html$/i.test(window.location.pathname)) return;

  const MOCK_URL = '../shared/data/esp32-mock.json';
  const LINKS_URL = `../shared/data/${current}-links.json`;

  function numbers(value) {
    return (String(value || '').match(/\d+/g) || []).map(Number);
  }

  function scoreLink(link, motor) {
    const text = `${link.text || ''} ${link.href || ''} ${link.target || ''}`;
    const nums = numbers(text);
    let score = 0;

    if (Number.isFinite(motor.slots) && nums.includes(Number(motor.slots))) score += 100;
    if (Number.isFinite(motor.rpm) && nums.includes(Number(motor.rpm))) score += 100;
    if (Number.isFinite(motor.poles) && nums.includes(Number(motor.poles))) score += 15;

    return score;
  }

  function makePanel(mock, matches) {
    const panel = document.createElement('section');
    panel.className = 'legacy-note';
    panel.dataset.esp32Test = '';

    const heading = document.createElement('strong');
    heading.textContent = 'Тест сопоставления ESP32 → справочник';

    const motor = mock.motor || {};
    const summary = document.createElement('p');
    summary.textContent = `Тестовые данные: ${motor.slots ?? '—'} пазов, ${motor.rpm ?? '—'} об/мин, ${motor.phases ?? '—'} фазы.`;

    panel.append(heading, summary);

    if (!matches.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Подходящих страниц по тестовым параметрам не найдено.';
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
      anchor.href = `page.html?src=${encodeURIComponent(link.target || link.href)}`;
      anchor.textContent = link.text || link.target || link.href;
      const meta = document.createElement('small');
      meta.textContent = ` — совпадение ${score}`;
      item.append(anchor, meta);
      list.appendChild(item);
    });
    panel.appendChild(list);

    return panel;
  }

  async function run() {
    try {
      const [mockResponse, linksResponse] = await Promise.all([fetch(MOCK_URL), fetch(LINKS_URL)]);
      if (!mockResponse.ok || !linksResponse.ok) throw new Error('test data unavailable');

      const mock = await mockResponse.json();
      const links = await linksResponse.json();
      const motor = mock.motor || {};
      const matches = (Array.isArray(links) ? links : [])
        .map((link) => ({ link, score: scoreLink(link, motor) }))
        .filter((entry) => entry.score >= 200 && entry.link.exists !== false)
        .sort((a, b) => b.score - a.score || String(a.link.text || '').localeCompare(String(b.link.text || ''), 'ru'));

      const host = document.querySelector('.legacy-content');
      if (!host || host.querySelector('[data-esp32-test]')) return;
      host.prepend(makePanel(mock, matches));

      window.CoilMasterEsp32TestResult = { mock, matches };
      document.dispatchEvent(new CustomEvent('coilmaster:esp32-test-result', { detail: window.CoilMasterEsp32TestResult }));
    } catch (error) {
      console.warn('ESP32 scheme matching test failed:', error);
    }
  }

  document.addEventListener('handbook:content-loaded', run, { once: true });
  run();
})();
