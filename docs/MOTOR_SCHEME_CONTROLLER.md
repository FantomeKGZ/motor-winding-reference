# Контроллер привязки схемы к карточке двигателя

`site/shared/js/motor-scheme-controller.js` связывает в один рабочий сценарий три ранее независимых компонента:

- `CoilMasterMotorSchemeWidget` — компактное отображение схемы в карточке двигателя;
- `CoilMasterSchemePicker` — выбор схемы укладки и конкретного подключения;
- `CoilMasterMotorBindingClient` — чтение/запись `winding_reference` через REST API ESP32.

## Назначение

Контроллер не является отдельной страницей. Его вызывает редактор или карточка двигателя и передаёт контейнер, `motor_id`, данные двигателя и список подходящих схем из каталога.

Пример:

```js
const controller = await window.CoilMasterMotorSchemeController.mount(
  document.querySelector('#motor-scheme'),
  {
    motorId: motor.id,
    motor,
    candidates: filteredCatalogSchemes,
    revision: motor.revision
  }
);
```

После этого контроллер выполняет цепочку:

`GET binding -> render widget -> edit -> Scheme Picker -> PUT binding -> refresh widget`.

Удаление работает аналогично:

`widget -> confirm -> DELETE binding -> render empty state`.

## Состояние и ревизии

Контроллер хранит текущую `revision` записи двигателя. При сохранении или удалении она передаётся как `expected_revision`.

Если ESP32 отвечает `409 Conflict`, данные автоматически не перезаписываются. Публикуется событие:

`coilmaster:motor-scheme-conflict`

и вызывается `onConflict`, если он задан. Редактор двигателя может предложить пользователю перечитать свежую карточку и повторить изменение.

## События

Контроллер публикует:

- `coilmaster:motor-scheme-refreshed`;
- `coilmaster:motor-scheme-saved`;
- `coilmaster:motor-scheme-removed`;
- `coilmaster:motor-scheme-conflict`;
- `coilmaster:motor-scheme-error`.

## Безопасность данных

Контроллер никогда не удаляет изображения или записи каталога. `DELETE` удаляет только `winding_reference` из конкретной карточки двигателя.

Сохранение разрешено самим `MotorBindingClient` только в режиме ESP32 `live`; тестовый `mock` режим не может случайно записать данные.

## Поведение при отсутствии схемы

Если двигатель ещё не имеет `winding_reference`, виджет показывает `Выбрать схему`. При открытии Scheme Picker пользователь выбирает конкретный `CM-SCH-*` и при необходимости `CM-CON-*`.

Если привязка существует, но соответствующая схема не присутствует в переданном списке кандидатов, ID не уничтожается и не заменяется автоматически. Редактор должен расширить/перечитать каталог либо показать состояние недоступной справочной схемы.

## Следующий этап

Следующая интеграция должна выполняться уже в веб-интерфейсе Motor Database на ESP32:

1. добавить контейнер `Обмотка и схемы` в карточку двигателя;
2. получить кандидатов из каталога по параметрам двигателя;
3. вызвать `CoilMasterMotorSchemeController.mount(...)`;
4. при `409` показать пользователю понятное предложение перечитать карточку;
5. после успешной записи обновить общую `revision` карточки двигателя.
