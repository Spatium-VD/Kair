(function () {
  /** Премии по проектам: детальные строки ведём с июня 2025 (лист jun-25 и новее). */
  var BONUS_DETAIL_FROM = '2025-06-01';

  var state = {
    managers: null,
    currentUser: null,
    allPayments: null,
    allBonusProjects: null
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatMoney(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  /** Премия в строке: «+» и модуль, без цветовой подсветки. */
  function formatBonusPlusAbs(value) {
    var v = Number(value);
    if (!Number.isFinite(v)) v = 0;
    var abs = Math.abs(v);
    return '<span>+' + formatMoney(abs) + '</span>';
  }

  /** Снятие внешних кавычек из ячейки CSV / таблицы */
  function stripOuterQuotes(s) {
    return String(s || '')
      .trim()
      .replace(/^["'\u201C\u201D\u00AB\u00BB]+|["'\u201C\u201D\u00AB\u00BB]+$/g, '');
  }

  /** Синонимы города из премий → короткий токен (коллизии с полным названием) */
  var CITY_CANON = {
    мск: 'мск',
    москва: 'мск',
    moscow: 'мск',
    msk: 'мск',
    нск: 'нск',
    новосибирск: 'нск',
    nsk: 'нск',
    крс: 'крс',
    красноярск: 'крс',
    krasnoyarsk: 'крс',
    екб: 'екб',
    екатеринбург: 'екб',
    ekb: 'екб',
    спб: 'спб',
    питер: 'спб',
    'санкт-петербург': 'спб',
    spb: 'спб'
  };

  function normalizeCityToken(s) {
    var t = stripOuterQuotes(s)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .trim();
    if (!t) return '';
    return CITY_CANON[t] || t;
  }

  /**
   * Колонка «города»: через запятую токены + спец-фразы.
   * — пусто → все города по проектам;
   * — «все города», «*», «все» → без городового фильтра;
   * — фраза с «самокат» и «весь»/«все» → для проектов, где в названии есть «Самокат», город не режем;
   *   при этом строки по другим проектам с пустым списком токенов не показываем (нужны явные города).
   */
  function parseCitySettings(raw) {
    var s = String(raw || '').trim();
    if (!s) {
      return { allCities: false, samokatAllCities: false, tokens: [] };
    }
    var allCities = false;
    var samokatAllCities = false;
    var tokens = [];
    var parts = s.split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = stripOuterQuotes(parts[i].trim());
      if (!p) continue;
      var pl = p.toLowerCase();
      if (pl === '*' || pl === 'все' || pl === 'все города' || pl === 'любой город') {
        allCities = true;
        continue;
      }
      if (pl.indexOf('самокат') !== -1 && (pl.indexOf('весь') !== -1 || pl.indexOf('все') !== -1)) {
        samokatAllCities = true;
        continue;
      }
      var canon = normalizeCityToken(p);
      if (canon) tokens.push(canon);
    }
    var seen = {};
    var uniq = [];
    for (var j = 0; j < tokens.length; j++) {
      if (!seen[tokens[j]]) {
        seen[tokens[j]] = true;
        uniq.push(tokens[j]);
      }
    }
    return { allCities: allCities, samokatAllCities: samokatAllCities, tokens: uniq };
  }

  function projectIsSamokat(name) {
    return String(name || '').toLowerCase().indexOf('самокат') !== -1;
  }

  function formatDate(isoDate) {
    if (!isoDate) return '';
    var parts = String(isoDate).split('-');
    if (parts.length !== 3) return String(isoDate);
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }

  function normalizeName(name) {
    if (!name) return '';
    return String(name)
      .toLowerCase()
      .replace(/[ё]/g, 'е')
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nameToSignature(name) {
    var norm = normalizeName(name).replace(/[^а-яa-z\s]/gi, ' ');
    var parts = norm.split(' ').filter(Boolean);
    var surname = parts[0] || '';
    var first = (parts[1] || '')[0] || '';
    var second = (parts[2] || '')[0] || '';
    if (!surname) return '';
    if (!second) return (surname + ' ' + first).replace(/\s+/g, ' ').trim();
    return (surname + ' ' + first + ' ' + second).replace(/\s+/g, ' ').trim();
  }

  // ── CSV parsing ──

  function parseCSV(text) {
    var lines = text.split('\n');
    if (lines.length < 2) return [];
    var headerLine = lines[0].replace(/^\uFEFF/, '');
    var headers = parseCSVLine(headerLine);
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var vals = parseCSVLine(line);
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j].trim()] = (vals[j] || '').trim();
      }
      rows.push(obj);
    }
    return rows;
  }

  function parseCSVLine(line) {
    var result = [];
    var current = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  }

  /**
   * @param {{ force?: boolean }} [opts] — force: заново скачать CSV (при входе, чтобы подтянуть города/проекты).
   */
  /** Города из строки managers: колонка «города» / cities; учёт лишних пробелов в заголовке CSV. */
  function getRawCitiesCell(row) {
    if (!row || typeof row !== 'object') return '';
    var direct =
      row.города !== undefined && row.города !== null && String(row.города).trim() !== ''
        ? String(row.города).trim()
        : row.cities !== undefined && row.cities !== null && String(row.cities).trim() !== ''
          ? String(row.cities).trim()
          : '';
    if (direct) return direct;
    for (var key in row) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
      var nk = String(key).trim().toLowerCase();
      if (nk === 'города' || nk === 'cities' || nk === 'город') {
        var v = row[key];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
    }
    return '';
  }

  async function loadManagers(opts) {
    var force = opts && opts.force;
    if (state.managers && !force) return state.managers;
    if (force) state.managers = null;
    var url = './managers.csv' + (force ? '?t=' + Date.now() : '');
    var res = await fetch(url, force ? { cache: 'no-store' } : {});
    var text = await res.text();
    state.managers = parseCSV(text);
    return state.managers;
  }

  // ── Session ──

  function getSessionUser() {
    try {
      var raw = sessionStorage.getItem('user');
      if (!raw) return null;
      var u = JSON.parse(raw);
      if (u && !Array.isArray(u.cities)) u.cities = [];
      if (u && typeof u.cityAllGlobally !== 'boolean') u.cityAllGlobally = false;
      if (u && typeof u.citySamokatAll !== 'boolean') u.citySamokatAll = false;
      return u;
    } catch (e) { return null; }
  }

  function setSessionUser(user) {
    sessionStorage.setItem('user', JSON.stringify(user));
  }

  function logout() {
    try { sessionStorage.clear(); } catch (e) {}
    window.location.href = './index.html';
  }

  // ── API ──

  async function apiGet(action) {
    var url = window.APPS_SCRIPT_URL + '?action=' + encodeURIComponent(action);
    var res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('API error: ' + res.status);
    var data = await res.json();
    if (data && typeof data === 'object' && !Array.isArray(data) && data.error) {
      throw new Error(String(data.error));
    }
    return data;
  }

  function setError(id, msg) {
    var el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  // ── Login ──

  async function handleLogin(e) {
    e.preventDefault();
    setError('errorBox', '');
    var fio = $('fioInput').value.trim();
    var pin = $('pinInput').value.trim();
    var btn = $('loginBtn');
    var spinner = $('loginSpinner');

    btn.disabled = true;
    spinner.style.display = 'block';
    try {
      var managers = await loadManagers({ force: true });
      var userSig = nameToSignature(fio);
      var match = null;
      for (var i = 0; i < managers.length; i++) {
        var m = managers[i];
        if (nameToSignature(m.fio_fot) === userSig && m.password === pin) {
          match = m;
          break;
        }
      }
      if (!match) {
        setError('errorBox', 'Неверное ФИО или PIN-код');
        return;
      }
      var projects = match.projects ? match.projects.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
      var rawCities = getRawCitiesCell(match);
      var cs = parseCitySettings(rawCities);
      setSessionUser({
        fioFot: match.fio_fot,
        nameBonus: match.name_bonus,
        projects: projects,
        cities: cs.tokens,
        cityAllGlobally: cs.allCities,
        citySamokatAll: cs.samokatAllCities,
        active: match.active
      });
      window.location.href = './dashboard.html';
    } finally {
      btn.disabled = false;
      spinner.style.display = 'none';
    }
  }

  // ── Dashboard ──

  function parseDateISO(value) {
    if (!value) return null;
    var d = new Date(value + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function matchesDateRange(isoDate, fromISO, toISO) {
    var d = parseDateISO(isoDate);
    if (!d) return false;
    if (fromISO) { var f = parseDateISO(fromISO); if (f && d < f) return false; }
    if (toISO) { var t = parseDateISO(toISO); if (t && d > t) return false; }
    return true;
  }

  function getUserPayments() {
    var user = state.currentUser;
    if (!user || !state.allPayments) return [];
    var sig = nameToSignature(user.fioFot);
    return state.allPayments.filter(function(r) {
      return r && nameToSignature(r.fio) === sig;
    });
  }

  function getUserBonusProjects() {
    var user = state.currentUser;
    if (!user || !state.allBonusProjects || !user.projects.length) return [];
    var projectSet = {};
    for (var i = 0; i < user.projects.length; i++) {
      projectSet[user.projects[i].toLowerCase()] = true;
    }
    var cityTokens = [];
    if (user.cities && user.cities.length) {
      for (var c = 0; c < user.cities.length; c++) {
        var tok = normalizeCityToken(user.cities[c]);
        if (tok) cityTokens.push(tok);
      }
    }
    var allGlob = !!user.cityAllGlobally;
    var samokatAll = !!user.citySamokatAll;
    var hasTokens = cityTokens.length > 0;

    return state.allBonusProjects.filter(function (r) {
      if (!r || !r.project) return false;
      if (projectSet[r.project.toLowerCase()] !== true) return false;

      if (allGlob) return true;

      var isSam = projectIsSamokat(r.project);
      if (samokatAll && isSam) return true;

      if (samokatAll && !hasTokens && !isSam) {
        return false;
      }

      if (!hasTokens) return true;

      var rc = normalizeCityToken(r.city);
      if (!rc) return false;
      for (var k = 0; k < cityTokens.length; k++) {
        if (rc === cityTokens[k]) return true;
      }
      return false;
    });
  }

  function applyFiltersAndRender() {
    var fromISO = $('dateFrom').value || '';
    var toISO = $('dateTo').value || '';

    renderFOT(fromISO, toISO);
    renderBonusProjects(fromISO, toISO);
  }

  function renderFOT(fromISO, toISO) {
    var allUser = getUserPayments();
    var records = allUser.filter(function(r) {
      return matchesDateRange(r.date, fromISO, toISO);
    });
    records.sort(function(a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });

    var tbody = $('fotTbody');
    tbody.innerHTML = '';
    if (!records.length) {
      var emptyMsg = 'Нет данных';
      if (allUser.length && (fromISO || toISO)) {
        emptyMsg =
          'За выбранный период ничего не попало. Очистите даты или нажмите «Показать за всё время» — часто браузер подставляет лишнее в поле «С».';
      } else if (!allUser.length) {
        emptyMsg =
          'В ФОТ не найдено строк по вашему ФИО. Сверьте написание с колонкой «Сотрудник» в Google Таблице и с полем fio_fot в managers.csv.';
      }
      tbody.innerHTML =
        '<tr><td colspan="4" class="text-muted text-center py-3">' + escapeHtml(emptyMsg) + '</td></tr>';
      $('fotTotal').textContent = '0';
      return;
    }

    var total = 0;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      total += Number(r.amount) || 0;
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(formatDate(r.date)) + '</td>' +
        '<td>' + escapeHtml(r.type || '') + '</td>' +
        '<td class="text-end">' + formatMoney(r.amount) + '</td>' +
        '<td>' + escapeHtml(r.status || '') + '</td>';
      tbody.appendChild(tr);
    }
    $('fotTotal').textContent = formatMoney(total);
  }

  function renderBonusProjects(fromISO, toISO) {
    var section = $('bonusSection');
    var content = $('bonusContent');
    var user = state.currentUser;

    if (!user || !user.projects.length) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';

    var records = getUserBonusProjects().filter(function (r) {
      return matchesDateRange(r.date, fromISO, toISO);
    });

    var hasBeforeJune = false;
    for (var hb = 0; hb < records.length; hb++) {
      if (records[hb].date && records[hb].date < BONUS_DETAIL_FROM) {
        hasBeforeJune = true;
        break;
      }
    }

    var recordsShown = records.filter(function (r) {
      return r.date && r.date >= BONUS_DETAIL_FROM;
    });

    if (!recordsShown.length) {
      var allB = getUserBonusProjects();
      var msg = 'Нет данных по проектам';
      if (records.length && !recordsShown.length) {
        msg =
          'В выбранном периоде есть только месяцы до июня 2025 — по ним детализация премий по проектам не велась. Расширьте период на июнь 2025 и позже.';
      } else if (allB.length && (fromISO || toISO)) {
        msg =
          'За выбранный период нет строк по проектам. Нажмите «Показать за всё время» или расширьте даты.';
      } else if (!allB.length && user.projects && user.projects.length) {
        msg =
          'Нет совпадений по проектам/городам из managers.csv и таблицы «Премия». Проверьте названия и колонку «города».';
      }
      var banner =
        '<div class="bonus-info-banner"><strong>Детализация с июня 2025.</strong> Блок «Премия по проектам» заполняется с периода <strong>июнь 2025</strong> (лист jun-25 и новее). Раньше детализация по проектам не велась.</div>';
      content.innerHTML = banner + '<div class="text-muted text-center py-3">' + escapeHtml(msg) + '</div>';
      $('bonusTotal').textContent = '0';
      return;
    }

    var byPeriod = {};
    var periodOrder = [];
    for (var i = 0; i < recordsShown.length; i++) {
      var r = recordsShown[i];
      var key = r.date || r.period;
      if (!byPeriod[key]) {
        byPeriod[key] = { period: r.period, date: r.date, rows: [] };
        periodOrder.push(key);
      }
      byPeriod[key].rows.push(r);
    }
    periodOrder.sort(function (a, b) { return b.localeCompare(a); });

    var html = '';
    html += '<div class="bonus-info-banner">';
    html +=
      '<strong>Детализация с июня 2025.</strong> Строки по проектам показываются с <strong>июня 2025</strong> (в таблице — листы jun-25 и новее). Раньше детализация по проектам не велась.';
    if (hasBeforeJune) {
      html +=
        ' В выбранном диапазоне были месяцы до июня 2025 — они скрыты в этой таблице.';
    }
    html += '</div>';

    var grandTotal = 0;
    for (var p = 0; p < periodOrder.length; p++) {
      var group = byPeriod[periodOrder[p]];
      var periodTotal = 0;
      html += '<div class="bonus-period">';
      html += '<div class="bonus-period-title">' + escapeHtml(group.period || formatDate(group.date)) + '</div>';
      html += '<div class="table-wrap"><table class="table table-sm mb-0">';
      html += '<thead><tr>' +
        '<th>Проект</th><th>Город</th>' +
        '<th class="text-end">ФОТ проекта</th>' +
        '<th class="text-end">Дивиденды</th>' +
        '<th class="text-end" title="По модулю с плюсом (как в таблице премий).">Премия (+)</th>' +
        '</tr></thead><tbody>';
      for (var j = 0; j < group.rows.length; j++) {
        var row = group.rows[j];
        periodTotal += Number(row.bonusManager) || 0;
        html += '<tr>' +
          '<td>' + escapeHtml(row.project) + '</td>' +
          '<td>' + escapeHtml(row.city || '') + '</td>' +
          '<td class="text-end">' + formatMoney(row.fot) + '</td>' +
          '<td class="text-end">' + formatMoney(row.dividends) + '</td>' +
          '<td class="text-end">' + formatBonusPlusAbs(row.bonusManager) + '</td>' +
          '</tr>';
      }
      html += '</tbody></table></div>';
      html += '<div class="bonus-period-total">Премия за период: <strong>' + formatMoney(Math.abs(periodTotal)) + '</strong> руб.</div>';
      html += '</div>';
      grandTotal += periodTotal;
    }
    content.innerHTML = html;
    $('bonusTotal').textContent = formatMoney(Math.abs(grandTotal));
  }

  function setDefaultDates(payments, bonuses) {
    var allDates = [];
    var i;
    for (i = 0; i < payments.length; i++) {
      if (payments[i].date) allDates.push(payments[i].date);
    }
    for (i = 0; i < bonuses.length; i++) {
      if (bonuses[i].date) allDates.push(bonuses[i].date);
    }
    if (!allDates.length) return;
    allDates.sort();
    $('dateFrom').value = allDates[0];
    $('dateTo').value = allDates[allDates.length - 1];
  }

  async function initDashboard() {
    var user = getSessionUser();
    if (!user) { window.location.href = './index.html'; return; }
    state.currentUser = user;

    if ($('dateFrom')) $('dateFrom').value = '';
    if ($('dateTo')) $('dateTo').value = '';
    var hint = $('dateHint');
    if (hint) {
      hint.style.display = 'none';
      hint.textContent = '';
    }

    $('greeting').textContent = 'Здравствуйте, ' + user.fioFot;
    var metaBits = [];
    if (user.projects && user.projects.length) {
      metaBits.push('Проекты: ' + user.projects.join(', '));
    }
    if (user.cityAllGlobally) {
      metaBits.push('Города: все (по настройке в списке)');
    } else if (user.citySamokatAll && user.cities && user.cities.length) {
      metaBits.push('Города: ' + user.cities.join(', ') + ' · для «Самокат» — все города');
    } else if (user.citySamokatAll && (!user.cities || !user.cities.length)) {
      metaBits.push('Города: «Самокат» — все города; прочие проекты из списка без токенов городов в премиях не показываются');
    } else if (user.cities && user.cities.length) {
      metaBits.push('Города: ' + user.cities.join(', '));
    } else if (user.projects && user.projects.length) {
      metaBits.push('Города: не заданы — по проектам показываются все города из таблицы');
    }
    $('userProjects').textContent = metaBits.join(' · ');
    $('logoutBtn').addEventListener('click', logout);

    $('dataSpinner').style.display = 'block';
    try {
      var promises = [apiGet('getPayments')];
      if (user.projects && user.projects.length) {
        promises.push(apiGet('getBonusProjects'));
      } else {
        promises.push(Promise.resolve([]));
      }
      var results = await Promise.all(promises);
      state.allPayments = Array.isArray(results[0]) ? results[0] : [];
      state.allBonusProjects = Array.isArray(results[1]) ? results[1] : [];
    } catch (err) {
      setError('dashboardError', err && err.message ? err.message : 'Ошибка загрузки данных');
      return;
    } finally {
      $('dataSpinner').style.display = 'none';
    }

    var userPayments = getUserPayments();
    var userBonuses = getUserBonusProjects();
    setDefaultDates(userPayments, userBonuses);

    if (hint && userPayments.length) {
      hint.style.display = 'block';
      hint.textContent =
        'Период подставлен по вашим данным. Если таблица пустая — нажмите «Показать за всё время» или проверьте поля «С» и «По».';
    }

    $('dateFrom').addEventListener('change', applyFiltersAndRender);
    $('dateTo').addEventListener('change', applyFiltersAndRender);
    var resetBtn = $('resetDatesBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        $('dateFrom').value = '';
        $('dateTo').value = '';
        applyFiltersAndRender();
      });
    }

    applyFiltersAndRender();
  }

  // ── Init ──

  function initLogin() {
    var form = $('loginForm');
    if (!form) return false;
    form.addEventListener('submit', handleLogin);
    return true;
  }

  function initByPage() {
    if (initLogin()) return;
    if ($('fotTbody')) {
      initDashboard().catch(function (err) {
        var box = $('dashboardError');
        if (box) {
          box.textContent = err && err.message ? err.message : String(err);
          box.style.display = 'block';
        }
      });
    }
  }

  window.addEventListener('DOMContentLoaded', initByPage);
})();
