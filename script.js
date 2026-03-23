(function () {
  const state = {
    employees: null,
    allPayments: null,
    allBonuses: null,
    currentUser: null,
    records: null
  };

  function $(id) {
    return document.getElementById(id);
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
    // Сигнатура по фамилии + первым буквам имени/отчества.
    // Примеры:
    // "Иванов И.И." -> "иванов и и"
    // "Иванов Иван Иванович" -> "иванов и и"
    const norm = normalizeName(name).replace(/[^а-яa-z\s]/gi, ' ');
    const parts = norm.split(' ').filter(Boolean);
    const surname = parts[0] || '';
    const first = (parts[1] || '')[0] || '';
    const second = (parts[2] || '')[0] || '';
    if (!surname) return '';
    if (!second) return `${surname} ${first}`.replace(/\s+/g, ' ').trim();
    return `${surname} ${first} ${second}`.replace(/\s+/g, ' ').trim();
  }

  function hashStr(s) {
    // Небольшой не-криптографический хеш, чтобы в логах не светить ФИО/инициалы.
    const str = String(s || '');
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
    // unsigned 32-bit
    return (h >>> 0).toString(16);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    // Русский формат с разделением пробелом
    return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatDate(isoDate) {
    if (!isoDate) return '';
    const parts = String(isoDate).split('-');
    if (parts.length !== 3) return String(isoDate);
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }

  async function apiGet(action) {
    const url = `${window.APPS_SCRIPT_URL}?action=${encodeURIComponent(action)}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  }

  function setError(id, message) {
    const el = $(id);
    if (!el) return;
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
  }

  function getSessionUser() {
    try {
      const raw = sessionStorage.getItem('user');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setSessionUser(user) {
    sessionStorage.setItem('user', JSON.stringify(user));
  }

  function clearSessionAndRedirectIndex() {
    try {
      sessionStorage.clear();
      localStorage.clear();
    } catch {
      // ignore
    }
    window.location.href = './index.html';
  }

  async function loadEmployeesIfNeeded() {
    if (state.employees) return;
    state.employees = await apiGet('getEmployees');
    // Ожидаемый формат: [{ fio }]
    if (!Array.isArray(state.employees)) state.employees = [];
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError('errorBox', '');
    const fio = $('fioInput').value;
    const loginBtn = $('loginBtn');
    const spinner = $('loginSpinner');

    loginBtn.disabled = true;
    spinner.style.display = 'block';
    try {
      await loadEmployeesIfNeeded();
      const userSig = nameToSignature(fio);

      // Найдём сотрудника по сигнатуре ФИО.
      const employee = state.employees.find((emp) => nameToSignature(emp.fio) === userSig);
      if (!employee) {
        setError('errorBox', 'Сотрудник не найден');
        return;
      }

      const user = {
        fioOriginal: employee.fio,
        fioSignature: nameToSignature(employee.fio)
      };
      setSessionUser(user);
      window.location.href = './dashboard.html';
    } finally {
      loginBtn.disabled = false;
      spinner.style.display = 'none';
    }
  }

  function parseDateISO(value) {
    // input[type=date] даёт yyyy-mm-dd
    if (!value) return null;
    const d = new Date(value + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  function toISODateOnly(dateObj) {
    const d = dateObj instanceof Date ? dateObj : parseDateISO(dateObj);
    if (!d) return null;
    return d.toISOString().slice(0, 10);
  }

  function recordDateToDate(record) {
    // record.date должен быть ISO yyyy-mm-dd
    if (!record || !record.date) return null;
    const d = new Date(record.date + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  function matchesDateRange(record, fromISO, toISO) {
    const d = recordDateToDate(record);
    if (!d) return false;
    const fromD = fromISO ? parseDateISO(fromISO) : null;
    const toD = toISO ? parseDateISO(toISO) : null;
    if (fromD && d < fromD) return false;
    if (toD && d > toD) return false;
    return true;
  }

  function rebuildRecordsForCurrentUser() {
    const user = state.currentUser;
    if (!user) return [];
    const sig = user.fioSignature;
    const all = [];
    if (Array.isArray(state.allPayments)) all.push(...state.allPayments);
    if (Array.isArray(state.allBonuses)) all.push(...state.allBonuses);

    const records = all.filter((r) => r && nameToSignature(r.fio) === sig);

    // Сортировка по дате (свежие сверху)
    records.sort((a, b) => {
      const da = recordDateToDate(a);
      const db = recordDateToDate(b);
      const ta = da ? da.getTime() : 0;
      const tb = db ? db.getTime() : 0;
      return tb - ta;
    });

    state.records = records;
    return records;
  }

  function getUniqueTypes(records) {
    const s = new Set();
    for (const r of records) {
      if (r && r.type) s.add(String(r.type));
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ru'));
  }

  function applyFiltersAndRender() {
    const fromISO = $('dateFrom').value || '';
    const toISO = $('dateTo').value || '';
    const typeVal = $('typeSelect').value || 'ALL';

    let records = Array.isArray(state.records) ? state.records : [];

    records = records.filter((r) => {
      if (typeVal !== 'ALL' && String(r.type || '') !== typeVal) return false;
      return matchesDateRange(r, fromISO, toISO);
    });

    const tbody = $('paymentsTbody');
    tbody.innerHTML = '';
    if (records.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" class="text-muted text-center py-4">Нет данных</td>';
      tbody.appendChild(tr);
      $('totalSum').value = '0';
      return;
    }

    let total = 0;
    for (const r of records) {
      total += Number(r.amount) || 0;
      const tr = document.createElement('tr');
      const status = r.status ? String(r.status) : '';
      const comment = r.comment ? String(r.comment) : '';
      tr.innerHTML = `
        <td>${escapeHtml(formatDate(r.date))}</td>
        <td>${escapeHtml(r.type || '')}</td>
        <td class="text-end">${formatMoney(r.amount)}</td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(comment || '')}</td>
      `;
      tbody.appendChild(tr);
    }

    $('totalSum').value = formatMoney(total);
  }

  async function loadDashboardDataIfNeeded() {
    if (state.allPayments && state.allBonuses) return;
    $('dataSpinner').style.display = 'block';
    $('dashboardError').style.display = 'none';
    try {
      const [payments, bonuses] = await Promise.all([apiGet('getPayments'), apiGet('getBonuses')]);
      state.allPayments = Array.isArray(payments) ? payments : [];
      state.allBonuses = Array.isArray(bonuses) ? bonuses : [];
    } catch (err) {
      setError('dashboardError', err && err.message ? err.message : 'Ошибка загрузки данных');
      throw err;
    } finally {
      $('dataSpinner').style.display = 'none';
    }
  }

  function setDefaultDateRangeFromRecords(records) {
    const dates = records
      .map((r) => r && r.date)
      .filter(Boolean)
      .map((iso) => new Date(iso + 'T00:00:00'))
      .filter((d) => !Number.isNaN(d.getTime()));

    if (!dates.length) return;
    dates.sort((a, b) => a.getTime() - b.getTime());
    const minISO = dates[0].toISOString().slice(0, 10);
    const maxISO = dates[dates.length - 1].toISOString().slice(0, 10);
    $('dateFrom').value = minISO;
    $('dateTo').value = maxISO;
  }

  async function initDashboard() {
    const user = getSessionUser();
    if (!user) {
      window.location.href = './index.html';
      return;
    }
    state.currentUser = user;

    $('greeting').textContent = `Здравствуйте, ${user.fioOriginal}`;
    $('logoutBtn').addEventListener('click', clearSessionAndRedirectIndex);

    await loadDashboardDataIfNeeded();
    rebuildRecordsForCurrentUser();

    const records = Array.isArray(state.records) ? state.records : [];
    setDefaultDateRangeFromRecords(records);

    // Типы
    const types = getUniqueTypes(records);
    const typeSelect = $('typeSelect');
    typeSelect.innerHTML = `<option value="ALL">Все</option>` + types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

    // Хук на фильтры
    $('dateFrom').addEventListener('change', applyFiltersAndRender);
    $('dateTo').addEventListener('change', applyFiltersAndRender);
    $('typeSelect').addEventListener('change', applyFiltersAndRender);

    applyFiltersAndRender();
  }

  function escapeHtml(str) {
    // минимальная защита на случай странных названий типов
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function initLogin() {
    const form = $('loginForm');
    if (!form) return false;
    form.addEventListener('submit', handleLogin);
    return true;
  }

  function initByPage() {
    // Если на странице есть loginForm -> это index.html
    if (initLogin()) return;
    // Иначе - dashboard
    if ($('paymentsTbody') && $('typeSelect')) {
      initDashboard().catch(() => {});
    }
  }

  window.addEventListener('DOMContentLoaded', initByPage);
})();

