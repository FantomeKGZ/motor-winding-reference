(() => {
  'use strict';

  function normalizePath(value) {
    return String(value || '').replace(/^\.\//, '').replace(/^\/+/, '');
  }

  function pageUrl(target) {
    const url = new URL('page.html', window.location.href);
    url.searchParams.set('src', normalizePath(target));
    url.searchParams.set('from', 'home');
    return `${url.pathname.split('/').pop()}${url.search}`;
  }

  function connectionLabels(meta) {
    const labels = [];
    (meta?.supported || []).forEach((kind) => {
      const label = kind === 'star' ? 'звезда' : kind === 'delta' ? 'треугольник' : kind;
      if (label && !labels.includes(label)) labels.push(label);
    });
    return labels;
  }

  function render(detail) {
    const variants = Array.isArray(detail?.filtered) ? detail.filtered : [];
    const cards = Array.from(document.querySelectorAll('[data-scheme-variants] .cm-scheme-variant'));
    if (!cards.length || !variants.length) return;

    cards.forEach((card, index) => {
      const variant = variants[index];
      if (!variant || card.querySelector('[data-connection-options-summary]')) return;

      const targets = Array.from(new Set((variant.connections || []).map(normalizePath).filter(Boolean)));
      const metas = Array.isArray(variant.connectionMeta) ? variant.connectionMeta : [];

      const block = document.createElement('div');
      block.className = 'cm-connection-options-summary';
      block.dataset.connectionOptionsSummary = '';

      const title = document.createElement('strong');
      title.textContent = `Схем подключения: ${targets.length}`;
      block.appendChild(title);

      if (!targets.length) {
        const note = document.createElement('small');
        note.textContent = 'Для этого варианта отдельная ссылка на схему подключения в исходном справочнике не найдена.';
        block.appendChild(note);
        card.appendChild(block);
        return;
      }

      const list = document.createElement('ul');
      targets.forEach((target, targetIndex) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = pageUrl(target);
        link.textContent = targets.length === 1 ? 'Схема подключения' : `Схема подключения ${targetIndex + 1}`;

        const meta = metas.find((entry) => normalizePath(entry?.target) === target);
        const labels = connectionLabels(meta);
        if (labels.length) link.textContent += ` — ${labels.join(' / ')}`;

        item.appendChild(link);
        list.appendChild(item);
      });
      block.appendChild(list);
      card.appendChild(block);
    });
  }

  document.addEventListener('coilmaster:scheme-variants', (event) => render(event.detail));
  if (window.CoilMasterSchemeVariants) render(window.CoilMasterSchemeVariants);
})();
