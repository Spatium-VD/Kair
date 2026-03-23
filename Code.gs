/**
 * Google Apps Script Web App API
 * Deploy as "web app" and call with:
 *   ?action=getEmployees|getPayments|getBonuses
 */

// ====== Конфигурация (вставьте ваши ID) ======
const PAYMENTS_SHEET_ID = '1uEhkppeQiRMgYC74qrlX8NK1BwlBqOPKYVrjnG9bhlA';
const PAYMENTS_SHEET_NAME = 'ФОТ офис';

const BONUSES_SHEET_ID = '1md_IvpL74RdZT-bGnXmIwEZJOacCphgpXLNMmtfvnrI';
// Внутри второй таблицы используйте лист с бонусами/корректировками.
// Если поставить 'AUTO' — скрипт попытается найти листы с нужными колонками.
const BONUSES_SHEET_NAME = 'AUTO';

const CACHE_TTL_SECONDS = 300;

function doGet(e) {
  try {
    const action = e && e.parameter ? String(e.parameter.action || '') : '';
    if (action === 'getEmployees') return jsonResponse(getEmployees());
    if (action === 'getPayments') return jsonResponse(getPayments());
    if (action === 'getBonuses') return jsonResponse(getBonuses());
    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message ? err.message : err) });
  }
}

function assertConfigured_() {
  if (PAYMENTS_SHEET_ID === 'ID_ТАБЛИЦЫ_ВЫПЛАТ') {
    throw new Error('Не задан PAYMENTS_SHEET_ID. Укажите ID таблицы выплат в Code.gs.');
  }
  if (BONUSES_SHEET_ID === 'ID_ТАБЛИЦЫ_БОНУСОВ') {
    throw new Error('Не задан BONUSES_SHEET_ID. Укажите ID таблицы бонусов в Code.gs.');
  }
}

function readCacheJson_(key) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch (err) {
    return null;
  }
}

function writeCacheJson_(key, value) {
  const cache = CacheService.getScriptCache();
  try {
    cache.put(key, JSON.stringify(value), CACHE_TTL_SECONDS);
  } catch (err) {
    // CacheService has payload limits; do not break API response on cache overflow.
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ====== Employees (from both tables) ======
function getEmployees() {
  assertConfigured_();
  const cacheKey = ['employees', PAYMENTS_SHEET_ID, PAYMENTS_SHEET_NAME, BONUSES_SHEET_ID, BONUSES_SHEET_NAME].join('|');
  const cached = readCacheJson_(cacheKey);
  if (cached) return cached;

  // В этой версии авторизация только по ФИО:
  // возвращаем все уникальные ФИО, которые встречаются в 2 таблицах.
  const set = {};

  const addFromPayments = getEmployeesFromSheet(PAYMENTS_SHEET_ID, PAYMENTS_SHEET_NAME);
  for (let i = 0; i < addFromPayments.length; i++) set[addFromPayments[i]] = true;

  if (BONUSES_SHEET_NAME !== 'AUTO') {
    const addFromBonuses = getEmployeesFromSheet(BONUSES_SHEET_ID, BONUSES_SHEET_NAME);
    for (let j = 0; j < addFromBonuses.length; j++) set[addFromBonuses[j]] = true;
  } else {
    const ss = SpreadsheetApp.openById(BONUSES_SHEET_ID);
    const sheets = ss.getSheets();
    for (let k = 0; k < sheets.length; k++) {
      const name = sheets[k].getName();
      try {
        const add = getEmployeesFromSheet(BONUSES_SHEET_ID, name);
        for (let t = 0; t < add.length; t++) set[add[t]] = true;
      } catch (err) {
        // ignore: not matching sheet
      }
    }
  }

  const out = [];
  const keys = Object.keys(set);
  for (let i2 = 0; i2 < keys.length; i2++) {
    if (!keys[i2]) continue;
    out.push({ fio: keys[i2] });
  }
  writeCacheJson_(cacheKey, out);
  return out;
}

function getEmployeesFromSheet(sheetId, sheetName) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = sheetName ? ss.getSheetByName(sheetName) : null;
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  const values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];

  const headerRowIdx = guessHeaderRow(values);
  const header = values[headerRowIdx];
  const keys = normalizeHeaders(header);
  const fioKey = pickKey(keys, /(фио|сотрудник)/i);
  if (!fioKey) return [];
  const fioIndex = keys.indexOf(fioKey);
  if (fioIndex < 0) return [];

  const set = {};
  for (let r = headerRowIdx + 1; r < values.length; r++) {
    const v = values[r][fioIndex];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    set[s] = true;
  }

  return Object.keys(set);
}

// ====== Sheets reading ======
function getSheetData(sheetId, sheetNameOrNull) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = sheetNameOrNull ? ss.getSheetByName(sheetNameOrNull) : null;
  if (!sheet) throw new Error('Sheet not found: ' + sheetNameOrNull);

  const values = sheet.getDataRange().getValues();
  if (!values || values.length === 0) return [];

  const headerRowIdx = guessHeaderRow(values);
  const header = values[headerRowIdx];
  const keys = normalizeHeaders(header);

  const out = [];
  for (let r = headerRowIdx + 1; r < values.length; r++) {
    const row = values[r];
    const obj = {};
    let hasAny = false;

    for (let c = 0; c < keys.length; c++) {
      const key = keys[c];
      if (!key) continue;
      let v = row[c];
      if (v === '' || v === null || typeof v === 'undefined') v = null;
      if (typeof v === 'string') v = v.trim();
      if (v !== null && v !== '') hasAny = true;
      obj[key] = v;
    }
    if (hasAny) out.push(obj);
  }
  return out;
}

function guessHeaderRow(values) {
  // Смотрим первые 20 строк и ищем строку, похожую на заголовки.
  const limit = Math.min(20, values.length);
  let best = { score: -1, idx: 0 };
  const keywords = ['фио', 'сотрудник', 'год', 'месяц', 'период', 'сумма', 'премия', 'статус', 'комментар', 'проект', 'тип', 'расход'];

  for (let r = 0; r < limit; r++) {
    const row = values[r];
    let score = 0;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell === null || typeof cell === 'undefined') continue;
      const s = String(cell).toLowerCase();
      for (let k = 0; k < keywords.length; k++) {
        if (s.indexOf(keywords[k]) !== -1) score++;
      }
    }
    if (score > best.score) best = { score: score, idx: r };
  }
  return best.idx;
}

function normalizeHeaders(headerRow) {
  const used = {};
  const keys = [];
  for (let i = 0; i < headerRow.length; i++) {
    const raw = headerRow[i];
    const key = raw === null || typeof raw === 'undefined' ? '' : String(raw).trim();
    if (!key) {
      keys.push('');
      continue;
    }
    const base = key;
    if (!used[base]) {
      used[base] = 1;
      keys.push(base);
    } else {
      used[base] = used[base] + 1;
      keys.push(base + '_' + used[base]);
    }
  }
  return keys;
}

function pickKey(keys, regex) {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k && regex.test(k)) return k;
  }
  return null;
}

function findAllKeys(keys, regex) {
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k && regex.test(k)) out.push(k);
  }
  return out;
}

function parseFloatSafe(v) {
  if (v === null || typeof v === 'undefined') return null;
  const s = String(v).replace(/\s+/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function toIsoDateFromYearMonth(year, month) {
  if (year === null || month === null || typeof year === 'undefined' || typeof month === 'undefined') return null;
  const y = parseInt(String(year), 10);
  const m = parseInt(String(month), 10);
  if (!y || !m || m < 1 || m > 12) return null;
  const mm = (m < 10 ? '0' + m : String(m));
  return String(y) + '-' + mm + '-01';
}

function unpivotPayments(rows, keys) {
  const fioKey = pickKey(keys, /(фио|сотрудник)/i);
  const yearKey = pickKey(keys, /год/i);
  const monthKey = pickKey(keys, /месяц/i);
  const statusKey = pickKey(keys, /статус/i);

  const commentKeys = findAllKeys(keys, /комментар/i);
  const commentKey = commentKeys.length ? commentKeys[0] : null;

  const exclude = {};
  [fioKey, yearKey, monthKey, statusKey, commentKey, 'Итого', 'Расходы', 'Должность', 'Город', 'Период'].forEach(function (k) {
    if (k) exclude[k] = true;
  });

  const typeKeys = keys.filter(function (k) {
    if (!k) return false;
    if (exclude[k]) return false;
    return true;
  });

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fio = row[fioKey] || '';
    if (!fio) continue;
    const date = toIsoDateFromYearMonth(row[yearKey], row[monthKey]);
    if (!date) continue;
    const status = statusKey ? (row[statusKey] || '') : '';
    const comment = commentKey ? (row[commentKey] || '') : '';

    for (let t = 0; t < typeKeys.length; t++) {
      const tk = typeKeys[t];
      const amount = parseFloatSafe(row[tk]);
      if (amount === null) continue;
      // В исключаемые ключи выше не попадём, но проверка на всякий случай
      if (tk === 'Итого') continue;
      out.push({
        date: date,
        type: tk,
        amount: amount,
        status: status,
        comment: comment,
        fio: fio
      });
    }
  }
  return out;
}

// ====== Payments ======
function getPayments() {
  assertConfigured_();
  const cacheKey = ['payments', PAYMENTS_SHEET_ID, PAYMENTS_SHEET_NAME].join('|');
  const cached = readCacheJson_(cacheKey);
  if (cached) return cached;

  const rows = getSheetData(PAYMENTS_SHEET_ID, PAYMENTS_SHEET_NAME);
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  const out = unpivotPayments(rows, keys);
  writeCacheJson_(cacheKey, out);
  return out;
}

// ====== Bonuses / corrections ======
function getBonuses() {
  assertConfigured_();
  const cacheKey = ['bonuses', BONUSES_SHEET_ID, BONUSES_SHEET_NAME].join('|');
  const cached = readCacheJson_(cacheKey);
  if (cached) return cached;

  if (BONUSES_SHEET_NAME !== 'AUTO') {
    const rows = getSheetData(BONUSES_SHEET_ID, BONUSES_SHEET_NAME);
    const out = transformBonusesRows(rows);
    writeCacheJson_(cacheKey, out);
    return out;
  }

  const ss = SpreadsheetApp.openById(BONUSES_SHEET_ID);
  const sheets = ss.getSheets();
  const all = [];
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getName();
    try {
      const rows = getSheetData(BONUSES_SHEET_ID, name);
      if (!rows.length) continue;
      const transformed = transformBonusesRows(rows);
      if (transformed && transformed.length) {
        all.push.apply(all, transformed);
      }
    } catch (err) {
      // ignore: sheet doesn't match expected format
    }
  }
  writeCacheJson_(cacheKey, all);
  return all;
}

function transformBonusesRows(rows) {
  if (!rows || !rows.length) return [];
  const keys = Object.keys(rows[0]);

  const fioKey = pickKey(keys, /(фио|сотрудник)/i);
  const yearKey = pickKey(keys, /год/i);
  const monthKey = pickKey(keys, /(месяц число|месяц(?!\s*числ)|месяц)/i);
  const statusKey = pickKey(keys, /статус/i);

  const commentKeys = findAllKeys(keys, /комментар/i);
  const commentKey = commentKeys.length ? commentKeys[0] : null;

  const amountKeys = findAllKeys(keys, /сумма/i);
  if (!amountKeys.length) return [];
  const amountKey = pickKey(amountKeys, /премии/i) || pickKey(amountKeys, /сумма/i) || amountKeys[0];

  // Тип выплаты: приоритет важен, т.к. в разных листах "тип" лежит в разных колонках.
  // Например, в "Прочие расходы" логичнее показывать "Расход униф.", а не "Проект".
  const typeKey =
    pickKey(keys, /тип/i) ||
    pickKey(keys, /расход униф/i) ||
    pickKey(keys, /про(е|ё)кт/i) ||
    pickKey(keys, /расходы/i);

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fio = row[fioKey] || '';
    if (!fio) continue;

    const date = toIsoDateFromYearMonth(row[yearKey], row[monthKey]);
    if (!date) continue;

    const amount = parseFloatSafe(row[amountKey]);
    if (amount === null) continue;

    const type = typeKey ? (row[typeKey] || amountKey) : amountKey;
    const status = statusKey ? (row[statusKey] || '') : '';
    const comment = commentKey ? (row[commentKey] || '') : '';

    out.push({
      date: date,
      type: type,
      amount: amount,
      status: status,
      comment: comment,
      fio: fio
    });
  }

  return out;
}

