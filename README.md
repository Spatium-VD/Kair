# Детализация выплат (HTML/JS + Google Apps Script)

Этот проект — статический фронтенд (`index.html`, `dashboard.html`) и Google Apps Script API (`Code.gs`).
Сотрудник входит по `ФИО`, после чего видит детализацию выплат/бонусов.

## 1) Подготовьте Google Таблицы

Вам нужны 2 Google Spreadsheet:

1. Таблица выплат (`PAYMENTS_SHEET_ID`)
   - В коде по умолчанию ожидается лист `ФОТ офис`.
2. Таблица бонусов/корректировок (`BONUSES_SHEET_ID`)
   - В коде по умолчанию стоит `BONUSES_SHEET_NAME = 'AUTO'` (поиск по всем листам).

Если у вас листы называются иначе, измените `PAYMENTS_SHEET_NAME` / `BONUSES_SHEET_NAME` в `Code.gs`
или задайте их через Script Properties.

## 2) Создайте проект Apps Script

1. Откройте [script.google.com](https://script.google.com).
2. Нажмите **Создать проект**.
3. Внутри проекта откройте файл `Code.gs` (или создайте новый файл) и замените его содержимое на код из вашего локального `Code.gs`.

## 3) Вставьте ID таблиц в `Code.gs`

Откройте локально `Code.gs` и замените:

- `PAYMENTS_SHEET_ID` на ID таблицы выплат
- `BONUSES_SHEET_ID` на ID таблицы бонусов

Также можно не хранить ID в коде, а задать Script Properties в Apps Script:
- `PAYMENTS_SHEET_ID`
- `PAYMENTS_SHEET_NAME`
- `BONUSES_SHEET_ID`
- `BONUSES_SHEET_NAME`

ID таблицы находится в URL, например:

`https://docs.google.com/spreadsheets/d/СПИСОК_ID/edit...`

Подставьте часть между `/d/` и `/edit`.

## 4) Настройте сотрудников (верификация по ФИО)

Пароли больше не используются.
Список сотрудников для входа возвращает `getEmployees()`, он берёт уникальные значения ФИО из двух таблиц (колонки `ФИО` / `Сотрудник`).

## 5) Разверните как Web App

1. Нажмите **Deploy** -> **New deployment**.
2. Выберите тип развёртывания: **Web app**.
3. Настройки:
   - Execute as: `Me`
   - Who has access: `Anyone with Google account` (можно иначе, но так проще)
4. Нажмите **Deploy** и подтвердите разрешения.
5. Скопируйте URL вида:
   `https://script.google.com/macros/s/<SCRIPT_ID>/exec`

## 6) Вставьте URL в `config.js`

Откройте локально `config.js` и замените:

`window.APPS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_URL_HERE';`

на ваш URL из шага 5.

## 7) Запустите фронтенд локально

Поскольку фронтенд делает `fetch`, удобнее открывать файлы через локальный сервер:

В папке проекта выполните (macOS/Linux):
```bash
python3 -m http.server 8080
```

Откройте:

`http://localhost:8080/index.html`

## 8) Проверка

1. В браузере откройте `index.html`.
2. Введите ФИО (которое есть в таблицах).
3. После логина откроется `dashboard.html`.

Если какие-то листы/колонки не совпали по названиям:
- проверьте `PAYMENTS_SHEET_NAME` / `BONUSES_SHEET_NAME` в `Code.gs`
- уточните заголовки колонок (скрипт ищет ключи по смысловым словам: `ФИО`, `Сотрудник`, `Год`, `Месяц`, `Сумма`, `Статус`, `Комментарий`).

## CORS (важно для `fetch`)

Браузер обращается к вашему Apps Script Web App через `fetch`.
В Google Apps Script нельзя вручную проставить заголовки CORS (например, `Access-Control-Allow-Origin`) через `setHeader`.
Обычно нужные CORS-заголовки добавляются автоматически при правильном Deploy как **Web app**.

