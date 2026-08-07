(() => {
  'use strict';

  const STORAGE_KEY = 'coilmaster-handbook-interface';
  const validChoices = new Set(['desktop', 'mobile']);
  const params = new URLSearchParams(window.location.search);
  const forceSelector = params.get('choose') === '1';

  function getStoredChoice() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return validChoices.has(value) ? value : null;
    } catch {
      return null;
    }
  }

  function storeChoice(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Local storage may be disabled. Navigation must still work.
    }
  }

  function clearChoice() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing else is required.
    }
  }

  function suggestedChoice() {
    return window.matchMedia('(max-width: 800px)').matches ? 'mobile' : 'desktop';
  }

  function navigate(choice) {
    window.location.replace(`${choice}/`);
  }

  const storedChoice = getStoredChoice();
  if (storedChoice && !forceSelector) {
    navigate(storedChoice);
    return;
  }

  const suggested = suggestedChoice();
  const hint = document.querySelector('[data-entry-hint]');
  if (hint) {
    hint.textContent = suggested === 'mobile'
      ? 'Для этого экрана рекомендуется версия для телефона. Выбор можно изменить в любое время.'
      : 'Для этого экрана рекомендуется версия для компьютера. Выбор можно изменить в любое время.';
  }

  document.querySelectorAll('[data-interface-choice]').forEach((link) => {
    const choice = link.dataset.interfaceChoice;
    if (!validChoices.has(choice)) return;

    if (choice === suggested) {
      link.setAttribute('aria-describedby', 'entry-title');
      link.title = 'Рекомендуемый вариант для текущего экрана';
    }

    link.addEventListener('click', (event) => {
      const remember = document.querySelector('[data-remember-choice]');
      if (remember?.checked) {
        event.preventDefault();
        storeChoice(choice);
        navigate(choice);
      } else {
        clearChoice();
      }
    });
  });

  document.querySelector('[data-clear-choice]')?.addEventListener('click', () => {
    clearChoice();
    const hintNode = document.querySelector('[data-entry-hint]');
    if (hintNode) hintNode.textContent = 'Сохранённый выбор удалён. Выберите нужную версию.';
  });
})();
