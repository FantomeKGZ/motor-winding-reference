# Scheme Catalog Client

## Назначение

`site/shared/js/scheme-catalog-client.js` — браузерный слой чтения готового каталога схем. Он относится только к внешнему сайту и не требует изменений ESP32.

Клиент нужен, чтобы карточка двигателя и Scheme Picker могли получать кандидатов напрямую из `desktop-scheme-catalog.json` / `mobile-scheme-catalog.json`, а не повторно разбирать сотни старых HTML-страниц.

## Источник данных

По умолчанию клиент ожидает:

```text
site/shared/data/desktop-scheme-catalog.json
site/shared/data/mobile-scheme-catalog.json
```

Каталоги строятся `tools/build_scheme_catalog.py` и валидируются `tools/validate_scheme_catalog.py`.

До финального деплоя важно убедиться, что сгенерированные JSON действительно включаются в публикуемую сборку сайта. Если файла нет, основной справочник продолжает работать; каталог считается временно недоступным.

## Публичный API

```js
window.CoilMasterSchemeCatalogClient.loadCatalog()
window.CoilMasterSchemeCatalogClient.findCandidates(motor)
window.CoilMasterSchemeCatalogClient.getScheme(schemeId)
window.CoilMasterSchemeCatalogClient.getConnection(schemeId, connectionId)
```

## Логика фильтрации

Первичный фильтр строгий:

```text
slots + rpm
```

После этого используются только известные с обеих сторон уточняющие параметры:

```text
q
poles / 2p
winding_type
parallel_branches
winding_pitch
```

Если уточняющее поле отсутствует в каталоге, кандидат не удаляется только из-за отсутствия данных. Неизвестные параметры не вычисляются по имени файла.

Связь `connection_id -> scheme_id` берётся из `connection_options[]` выбранной схемы.

## Интеграция с карточкой двигателя

`motor-scheme-controller.js` теперь умеет автоматически вызвать `findCandidates(motor)`, если вызывающая сторона не передала `candidates` вручную.

То есть будущая карточка сможет передать только реальные данные двигателя:

```js
CoilMasterMotorSchemeController.mount(container, {
  motorId: motor.id,
  motor,
  revision: motor.revision
});
```

а внешний сайт сам загрузит каталог и подготовит список для Scheme Picker.

## События

После загрузки каталога:

```text
coilmaster:scheme-catalog-ready
```

После подбора кандидатов:

```text
coilmaster:scheme-candidates-ready
```

При ошибке каталога контроллер публикует:

```text
coilmaster:motor-scheme-catalog-error
```

Ошибка каталога не должна блокировать основную карточку двигателя или обычный справочник.

## Ограничение проекта

На текущем этапе изменяется только внешний сайт `motor-winding-reference`. Прошивка ESP32, Motor Database и встроенный сайт ESP32 не изменяются.

Будущий ChatGPT/ИИ перед началом ESP32-интеграции должен сначала прочитать корневой `ESP32_CONNECTION_HANDOFF.md` и сверить этот клиент с актуальным контрактом ESP32.
