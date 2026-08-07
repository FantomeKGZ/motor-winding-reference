(() => {
  'use strict';

  function normalize(value) {
    return String(value || '')
      .toLocaleLowerCase('ru-RU')
      .replace(/ё/g, 'е')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function classifyText(value) {
    const text = normalize(value);
    const tags = new Set();

    if (/даландер|dahlander/.test(text)) tags.add('dahlander');
    if (/двухскорост|2\s*скорост|две\s+скорост/.test(text)) tags.add('two-speed');
    if (/трехскорост|3\s*скорост|три\s+скорост/.test(text)) tags.add('three-speed');
    if (/многоскорост|переключени[^.]{0,40}(?:числ|количеств)[^.]{0,20}полюс|полюсопереключ/.test(text)) tags.add('pole-changing');
    if (/две\s+обмотк|двух\s+обмотк|раздельн[^.]{0,30}обмотк/.test(text)) tags.add('separate-windings');
    if (/двойн[^.]{0,20}звезд|двойная\s+звезд|yy\b|y\/y/.test(text)) tags.add('double-star');
    if (/звезд[^.]{0,15}треуг|y\/?[Δδ∆d]|y-delta|star-delta/.test(text)) tags.add('star-delta');
    if (/треуг[^.]{0,15}двойн[^.]{0,15}звезд|delta[^.]{0,15}double[^.]{0,15}star/.test(text)) tags.add('delta-double-star');
    if (/переключаем[^.]{0,30}обмот|переключени[^.]{0,40}обмот/.test(text)) tags.add('switchable');

    return Array.from(tags);
  }

  function label(tag) {
    const labels = {
      dahlander: 'Даландер',
      'two-speed': 'двухскоростная',
      'three-speed': 'трёхскоростная',
      'pole-changing': 'переключение полюсов',
      'separate-windings': 'раздельные обмотки',
      'double-star': 'двойная звезда',
      'star-delta': 'звезда/треугольник',
      'delta-double-star': 'треугольник/двойная звезда',
      switchable: 'переключаемая схема',
    };
    return labels[tag] || tag;
  }

  function normalizeWanted(value) {
    const text = normalize(value);
    if (!text) return null;
    if (/даландер|dahlander/.test(text)) return 'dahlander';
    if (/двухскорост|2\s*скорост/.test(text)) return 'two-speed';
    if (/трехскорост|трёхскорост|3\s*скорост/.test(text)) return 'three-speed';
    if (/полюс|pole/.test(text)) return 'pole-changing';
    if (/раздельн|две\s+обмот/.test(text)) return 'separate-windings';
    if (/двойн[^.]{0,10}звезд|double-star|yy/.test(text)) return 'double-star';
    if (/звезд[^.]{0,10}треуг|star-delta/.test(text)) return 'star-delta';
    if (/треуг[^.]{0,10}двойн[^.]{0,10}звезд|delta-double-star/.test(text)) return 'delta-double-star';
    if (/переключ/.test(text)) return 'switchable';
    return text;
  }

  function classifyVariant(variant) {
    const source = [
      variant?.description,
      variant?.section,
      ...(variant?.hints || []),
      ...(variant?.connectionMeta || []).flatMap((meta) => [
        meta?.title,
        ...(meta?.images || []).map((image) => image?.description),
      ]),
    ].filter(Boolean).join(' ');

    return {
      key: `${variant?.target || ''}|${variant?.image || ''}`,
      tags: classifyText(source),
      source,
      variant,
    };
  }

  function cardKey(card) {
    const anchor = card.querySelector('.cm-scheme-variant-link[href]');
    if (!anchor) return '';
    try {
      const url = new URL(anchor.href, window.location.href);
      return `${url.searchParams.get('src') || ''}|${url.searchParams.get('img') || ''}`;
    } catch {
      return '';
    }
  }

  function annotate(detail) {
    if (!detail || !Array.isArray(detail.filtered)) return;

    const motor = detail.motor || {};
    const wanted = normalizeWanted(
      motor.special_connection ?? motor.speed_scheme ?? motor.special_scheme ?? motor.winding_switching
    );
    const classified = detail.filtered.map(classifyVariant);
    const byKey = new Map(classified.map((item) => [item.key, item]));
    let explicitMismatch = 0;

    document.querySelectorAll('.cm-scheme-variant').forEach((card) => {
      card.querySelector('.cm-special-scheme-tags')?.remove();
      const item = byKey.get(cardKey(card));
      if (!item) return;

      if (item.tags.length) {
        const meta = document.createElement('div');
        meta.className = 'cm-special-scheme-tags';
        meta.textContent = `Специальные признаки: ${item.tags.map(label).join(', ')}`;
        card.appendChild(meta);
      }

      if (wanted && item.tags.length && !item.tags.includes(wanted)) {
        card.dataset.specialMismatch = '1';
        card.hidden = true;
        explicitMismatch += 1;
      } else {
        card.removeAttribute('data-special-mismatch');
      }
    });

    const panel = document.querySelector('[data-scheme-variants]');
    if (panel) {
      panel.querySelector('[data-special-scheme-summary]')?.remove();
      const summary = document.createElement('p');
      summary.dataset.specialSchemeSummary = '';
      summary.className = 'cm-special-scheme-summary';
      if (wanted) {
        const visible = classified.length - explicitMismatch;
        summary.textContent = `Специальная схема ESP32: ${label(wanted)}. Явно несовместимых вариантов скрыто: ${explicitMismatch}; остаётся для проверки: ${visible}. Нераспознанные варианты не исключаются автоматически.`;
      } else {
        const tagged = classified.filter((item) => item.tags.length).length;
        summary.textContent = tagged
          ? `Специальные признаки распознаны у ${tagged} вариантов. Они показаны как подсказка и не используются для автоматического выбора без данных ESP32.`
          : 'Явных специальных или многоскоростных признаков среди текущих вариантов не обнаружено.';
      }
      panel.insertBefore(summary, panel.children[2] || null);
    }

    window.CoilMasterSpecialSchemeResult = {
      motor,
      wanted,
      classified,
      explicitMismatch,
    };
    document.dispatchEvent(new CustomEvent('coilmaster:special-scheme-result', {
      detail: window.CoilMasterSpecialSchemeResult,
    }));
  }

  document.addEventListener('coilmaster:scheme-variants', (event) => annotate(event.detail));
  if (window.CoilMasterSchemeVariants) annotate(window.CoilMasterSchemeVariants);
})();
