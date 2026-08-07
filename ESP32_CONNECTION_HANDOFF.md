# ESP32 ↔ CoilMaster Handbook — AI handoff для будущего подключения

Статус: `PREPARED / DO NOT IMPLEMENT ESP32 YET`

Дата: 2026-08-07

Назначение: этот файл должен быть понятен не только человеку, но и следующей сессии ChatGPT/ИИ, которая позже будет подключать ESP32 к уже подготовленному внешнему сайту справочника.

---

# 0. КРИТИЧЕСКОЕ ОГРАНИЧЕНИЕ ДЛЯ ИИ

**Сейчас работа ведётся только над внешним сайтом `motor-winding-reference`.**

Не изменять прошивку ESP32, проект CoilMaster OS или встроенный сайт ESP32, пока пользователь явно не скажет перейти к работе с ESP32.

Этот файл — только контракт, карта подключения и список будущих изменений.

Если ИИ открыл этот документ во время будущей интеграции, сначала:

1. прочитать этот файл полностью;
2. проверить актуальный код внешнего сайта;
3. проверить актуальную структуру Motor Database на ESP32;
4. не придумывать отсутствующие поля;
5. сохранять обратную совместимость со старыми карточками двигателей;
6. не переносить большие изображения справочника в Motor Database;
7. не связывать схему только по `motor_id`;
8. не выбирать неоднозначную схему автоматически без подтверждения пользователя.

---

# 1. Архитектура

Система состоит из двух независимых частей.

## Внешний сайт справочника

Репозиторий:

`FantomeKGZ/motor-winding-reference`

Ветка разработки:

`feature/site-shell`

Он владеет:

- старым архивом справочника;
- изображениями схем укладки;
- изображениями схем подключения;
- каталогом схем;
- `CM-SCH-*` идентификаторами укладки;
- `CM-CON-*` идентификаторами вариантов подключения;
- поиском и фильтрацией;
- Scheme Picker;
- виджетом `Обмотка и схемы`;
- JS-клиентами интеграции.

## ESP32 / CoilMaster

В будущем ESP32 должна владеть:

- Motor Database;
- карточками двигателей;
- REST API;
- хранением выбранной ссылки на схему;
- `revision` записи двигателя;
- read-only контекстом текущего двигателя.

ESP32 **не должна** владеть полной копией справочника внутри записи каждого двигателя.

Главное отношение:

`Motor record -> scheme_id -> handbook catalog -> layout + connection options`

---

# 2. Что уже есть во внешнем сайте

Ключевые файлы:

```text
site/shared/js/esp32-client.js
site/shared/js/esp32-panel.js
site/shared/js/esp32-scheme-matcher.js
site/shared/js/scheme-picker.js
site/shared/js/motor-scheme-widget.js
site/shared/js/motor-binding-client.js
site/shared/js/motor-scheme-controller.js
site/shared/js/connection-options-summary.js
site/shared/js/scheme-variant-navigation.js
site/shared/js/special-scheme-classifier.js
```

Документация:

```text
docs/ESP32_HTTP_CLIENT.md
docs/SCHEME_MAPPING.md
docs/SCHEME_CATALOG.md
docs/SCHEME_PICKER.md
docs/MOTOR_SCHEME_WIDGET.md
docs/MOTOR_SCHEME_CONTROLLER.md
docs/SPECIAL_SCHEMES.md
```

Генерация каталога:

```text
tools/build_scheme_catalog.py
tools/validate_scheme_catalog.py
```

---

# 3. Идентификаторы

## Укладка

Формат:

```text
CM-SCH-XXXXXXXXXXXX
```

Это стабильный идентификатор конкретного варианта укладки.

## Подключение

Формат:

```text
CM-CON-XXXXXXXXXXXX
```

Это стабильный идентификатор конкретного варианта подключения.

### Правило

ESP32 должна сохранять ID, а не использовать старые пути типа:

```text
y363000.html
ss2k3000a2.html
```

как основной постоянный ключ.

Legacy-пути допустимы только как служебная информация/отладка.

---

# 4. Что хранить в карточке двигателя ESP32

Добавить необязательный блок:

```json
{
  "winding_reference": {
    "version": 1,
    "scheme_id": "CM-SCH-XXXXXXXXXXXX",
    "connection_id": "CM-CON-XXXXXXXXXXXX",
    "catalog_version": 3,
    "binding_source": "user",
    "verification": "confirmed",
    "bound_at": "2026-08-07T12:00:00Z"
  }
}
```

## Обязательные правила

- `winding_reference` должен быть необязательным;
- старые двигатели без этого блока должны продолжать работать;
- `scheme_id` обязателен, если блок существует;
- `connection_id` может быть `null` или отсутствовать;
- ESP32 не должна копировать весь `connections[]` из каталога в карточку двигателя;
- изображения не сохраняются в Motor Database;
- удаление двигателя не удаляет схему из справочника;
- удаление привязки не удаляет файлы справочника.

---

# 5. Контекст текущего двигателя: ESP32 -> внешний сайт

Внешний сайт уже ожидает read-only endpoint:

```http
GET /api/context
```

Пример ответа:

```json
{
  "motor": {
    "id": "motor-42",
    "model": "АИР100L2",
    "slots": 36,
    "rpm": 3000,
    "poles": 2,
    "q": 6,
    "winding_type": "two_layer",
    "parallel_branches": 2,
    "winding_pitch": "10",
    "connection": "Y",
    "special_connection": null,
    "revision": 17,
    "winding_reference": {
      "version": 1,
      "scheme_id": "CM-SCH-XXXXXXXXXXXX",
      "connection_id": "CM-CON-XXXXXXXXXXXX",
      "catalog_version": 3,
      "binding_source": "user",
      "verification": "confirmed"
    }
  }
}
```

## Поля не должны угадываться

Если поле неизвестно:

```json
"q": null
```

или поле может отсутствовать.

Не вычислять неизвестное значение только ради заполнения API.

---

# 6. REST API привязки схемы к двигателю

Внешний сайт подготовлен под следующие маршруты.

## Читать привязку

```http
GET /api/motors/{motor_id}/winding-reference
```

Пример ответа:

```json
{
  "motor_id": "motor-42",
  "revision": 17,
  "winding_reference": {
    "version": 1,
    "scheme_id": "CM-SCH-XXXXXXXXXXXX",
    "connection_id": "CM-CON-XXXXXXXXXXXX",
    "catalog_version": 3,
    "binding_source": "user",
    "verification": "confirmed"
  }
}
```

Если привязки нет, допустимо вернуть:

```json
{
  "motor_id": "motor-42",
  "revision": 17,
  "winding_reference": null
}
```

## Сохранить/изменить привязку

```http
PUT /api/motors/{motor_id}/winding-reference
Content-Type: application/json
```

Тело:

```json
{
  "expected_revision": 17,
  "winding_reference": {
    "version": 1,
    "scheme_id": "CM-SCH-XXXXXXXXXXXX",
    "connection_id": "CM-CON-XXXXXXXXXXXX",
    "catalog_version": 3,
    "binding_source": "user",
    "verification": "confirmed"
  }
}
```

Успешный ответ:

```json
{
  "motor_id": "motor-42",
  "revision": 18,
  "winding_reference": {
    "version": 1,
    "scheme_id": "CM-SCH-XXXXXXXXXXXX",
    "connection_id": "CM-CON-XXXXXXXXXXXX",
    "catalog_version": 3,
    "binding_source": "user",
    "verification": "confirmed"
  }
}
```

## Удалить привязку

```http
DELETE /api/motors/{motor_id}/winding-reference
Content-Type: application/json
```

Опциональное тело:

```json
{
  "expected_revision": 18
}
```

Ответ:

```json
{
  "motor_id": "motor-42",
  "revision": 19,
  "winding_reference": null
}
```

---

# 7. Защита от одновременного редактирования

Motor Database должна иметь `revision`.

При чтении карточки браузер получает текущую ревизию.

При записи отправляет:

```json
"expected_revision": 17
```

Если запись уже была изменена и актуальная ревизия, например, `18`, ESP32 должна ответить:

```http
409 Conflict
```

Пример JSON:

```json
{
  "error": "revision_conflict",
  "motor_id": "motor-42",
  "expected_revision": 17,
  "actual_revision": 18
}
```

**Не перезаписывать молча более новую карточку.**

---

# 8. Валидация ID на ESP32

Минимальная проверка формата:

```text
scheme_id     -> ^CM-SCH-[A-Z0-9]+$
connection_id -> ^CM-CON-[A-Z0-9]+$
```

Если на microSD есть компактный каталог, желательно дополнительно проверить:

1. существует ли `scheme_id`;
2. существует ли `connection_id`;
3. принадлежит ли `connection_id` выбранному `scheme_id`.

Если локального каталога нет, отсутствие этой глубокой проверки **не должно ломать Motor Database**.

---

# 9. Как внешний сайт подбирает схему

Подбор уже спроектирован многоступенчато.

Порядок:

```text
slots + rpm
    ↓
q
    ↓
poles / 2p
    ↓
winding_type
    ↓
parallel_branches (a)
    ↓
winding_pitch (y)
    ↓
connection
    ↓
special_connection
```

Правило:

- если параметр известен с обеих сторон — использовать для фильтрации;
- если параметр в старом справочнике не найден надёжно — не отбрасывать вариант только из-за неизвестности;
- если после фильтрации остаётся несколько схем — показать их пользователю;
- не выбирать автоматически неоднозначную схему.

---

# 10. Несколько схем подключения

Это обязательное требование.

У одной укладки может быть:

- 0 схем подключения;
- 1 схема;
- несколько схем.

Проверенный каталог содержит варианты вплоть до нескольких отдельных страниц подключения для одной укладки.

Следовательно:

```text
scheme_id -> connection_options[]
```

а не:

```text
scheme_id -> one connection
```

ESP32 хранит только выбранный `connection_id`, если пользователь выбрал конкретное подключение.

Все допустимые варианты остаются в каталоге внешнего сайта.

---

# 11. Карточка двигателя — будущий UI на ESP32

При наличии `winding_reference.scheme_id` карточка должна иметь компактный блок:

```text
Обмотка и схемы

[превью укладки]
тип · y · a

Схемы подключения: N
[preview 1] [preview 2]

[Открыть]
[Изменить привязку]
```

Если подключений больше двух:

```text
Все схемы подключения (N)
```

Если выбран `connection_id`, отметить:

```text
Использовано на этом двигателе
```

Не отмечать остальные допустимые варианты как использованные.

---

# 12. Добавление и редактирование двигателя

Один и тот же Scheme Picker должен использоваться для:

- нового двигателя;
- существующего двигателя.

Поток:

```text
Motor form
   ↓
параметры двигателя
   ↓
Scheme Picker
   ↓
выбор CM-SCH
   ↓
выбор CM-CON (опционально)
   ↓
PUT winding-reference
   ↓
обновить карточку
```

Не создавать два разных механизма выбора схемы.

---

# 13. Файлы внешнего сайта, которые должен знать будущий ИИ

## ESP32 client

```text
site/shared/js/esp32-client.js
```

Назначение:

- режимы `off/mock/live`;
- адрес ESP32;
- таймаут;
- `GET /api/context`;
- событие `coilmaster:esp32-context`.

## Motor binding client

```text
site/shared/js/motor-binding-client.js
```

Ожидает:

```text
GET    /api/motors/{id}/winding-reference
PUT    /api/motors/{id}/winding-reference
DELETE /api/motors/{id}/winding-reference
```

Умеет распознавать `409 revision_conflict`.

## Scheme Picker

```text
site/shared/js/scheme-picker.js
```

Возвращает:

```json
{
  "scheme_id": "CM-SCH-...",
  "connection_id": "CM-CON-...",
  "catalog_version": 3
}
```

## Motor scheme widget

```text
site/shared/js/motor-scheme-widget.js
```

Показывает укладку и схемы подключения.

## Controller

```text
site/shared/js/motor-scheme-controller.js
```

Связывает:

```text
widget + picker + binding API
```

---

# 14. CORS / HTTP / HTTPS

Если внешний сайт открыт с другого origin, ESP32 должна разрешить CORS только для требуемых API.

Минимально для разработки:

```http
Access-Control-Allow-Origin: <approved-origin>
Access-Control-Allow-Methods: GET, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Accept
```

Не использовать `*` в финальной конфигурации без отдельного решения по безопасности.

## Mixed Content

Если внешний сайт работает по HTTPS, а ESP32 только по HTTP, браузер может заблокировать запрос.

Будущий ИИ должен проверить этот вопрос до отладки JavaScript.

Варианты решения должны обсуждаться отдельно:

- одинаковый HTTP внутри локальной сети;
- HTTPS на ESP32/прокси;
- локальный gateway/proxy;
- иной одобренный способ.

Не пытаться «исправлять» mixed content только JS-кодом — браузерная политика это не позволяет.

---

# 15. Производительность ESP32

Не делать на ESP32:

- разбор тысяч старых HTML-страниц при открытии карточки;
- полнотекстовый индекс всего справочника в RAM;
- копирование больших картинок в JSON Motor Database;
- загрузку всех connection options в каждую карточку двигателя.

Рекомендуемая нагрузка ESP32:

```text
маленький JSON motor record
+
маленький winding_reference
+
опциональный компактный индекс на microSD
```

Картинки и тяжёлый каталог обслуживает внешний справочник.

---

# 16. Поведение при недоступности справочника

Карточка двигателя должна работать даже если внешний справочник недоступен.

Если есть только сохранённые ID:

```text
Схема: CM-SCH-...
Подключение: CM-CON-...
Справочник временно недоступен
```

Нельзя блокировать:

- просмотр двигателя;
- редактирование обычных параметров;
- работу Motor Database;
- работу оборудования.

---

# 17. Что НЕ относится к этой интеграции

Этот API не должен напрямую:

- запускать двигатель;
- включать реле;
- менять счётчик витков;
- управлять Arduino UNO;
- отправлять CMP-команды;
- выполнять физическое управление намоткой.

Привязка схемы — это **данные справочника**, не команда оборудованию.

---

# 18. Рекомендуемый порядок будущей реализации на ESP32

ИИ должен выполнять по этапам.

## Этап 1 — Motor record schema

Добавить optional `winding_reference`.

Проверить загрузку старых записей без нового поля.

## Этап 2 — revision

Убедиться, что карточки имеют корректную ревизию для optimistic concurrency.

## Этап 3 — read-only context

Реализовать:

```text
GET /api/context
```

Сначала только чтение.

## Этап 4 — binding GET

Реализовать:

```text
GET /api/motors/{id}/winding-reference
```

## Этап 5 — binding PUT/DELETE

Только после успешного чтения.

Реализовать `expected_revision` и `409`.

## Этап 6 — CORS и интеграционный тест

Проверить запросы с внешнего сайта.

## Этап 7 — встроенная карточка двигателя

Подключить UI уже после стабильного API.

## Этап 8 — optional microSD catalog cache

Только после основной интеграции.

---

# 19. Контрольные сценарии

Будущий ИИ обязан проверить минимум:

### Сценарий A

Старый двигатель без `winding_reference` открывается без ошибок.

### Сценарий B

Выбран `CM-SCH`, connection не выбран.

### Сценарий C

Выбран `CM-SCH` + `CM-CON`.

### Сценарий D

У одной укладки несколько connection options — ни один не теряется.

### Сценарий E

Удаление binding оставляет двигатель и справочник целыми.

### Сценарий F

Два браузера редактируют одну карточку — второй получает `409`, а не перезаписывает данные.

### Сценарий G

Справочник недоступен — Motor Database работает.

### Сценарий H

ESP32 недоступна — внешний справочник работает автономно.

---

# 20. Запрещённые упрощения для будущего ИИ

Не делать:

```text
motor_id == scheme_id
```

Не делать:

```text
36 пазов + 3000 -> автоматически взять первую картинку
```

Не делать:

```text
одна укладка = одна схема подключения
```

Не делать:

```text
скопировать все картинки в запись двигателя
```

Не делать:

```text
если connection_id неизвестен — придумать его
```

Не делать:

```text
если API не совпадает — молча изменить внешний сайт
```

При несовпадении сначала сверить этот контракт и актуальный код обеих сторон.

---

# 21. Что считать готовностью ESP32 к подключению

ESP32 готова к интеграционному тесту, когда выполняются все пункты:

- [ ] старые Motor records продолжают загружаться;
- [ ] `winding_reference` поддерживается;
- [ ] `revision` доступен;
- [ ] `GET /api/context` работает;
- [ ] `GET /api/motors/{id}/winding-reference` работает;
- [ ] `PUT /api/motors/{id}/winding-reference` работает;
- [ ] `DELETE /api/motors/{id}/winding-reference` работает;
- [ ] `409 revision_conflict` реализован;
- [ ] CORS согласован;
- [ ] mixed-content архитектура согласована;
- [ ] API не управляет оборудованием;
- [ ] схемы не дублируются в Motor Database;
- [ ] multiple connection options поддерживаются;
- [ ] интеграция проверена минимум на одном реальном двигателе.

---

# 22. Текущее состояние на дату этого файла

На стороне внешнего сайта уже подготовлены:

- сопоставление ESP32 -> справочник;
- mock/live клиент;
- панель подключения;
- Scheme Picker;
- Motor Scheme Widget;
- Motor Binding Client;
- Motor Scheme Controller;
- стабильные `CM-SCH-*`;
- подготовка `CM-CON-*`;
- каталог с несколькими connection options;
- документация интеграции.

**Прошивка ESP32 по этому документу ещё не изменялась.**

Это сделано намеренно: сначала полностью готовится внешний сайт и контракт, после чего ESP32 подключается отдельным этапом.

---

# 23. Инструкция ChatGPT, который будет выполнять подключение позже

Начни будущую сессию с формулировки задачи примерно так:

> Прочитай `ESP32_CONNECTION_HANDOFF.md` полностью. Сначала ничего не меняй. Сверь контракт с текущим `motor-winding-reference` и текущим CoilMaster/ESP32. Покажи расхождения. После подтверждения реализуй ESP32 по этапам из раздела 18, не меняя внешний контракт без причины.

Это позволит продолжить работу без потери архитектурных решений текущей разработки.
