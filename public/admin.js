'use strict';
/* Админ-панель Fracs — Telegram Mini App. Все запросы к /api/admin/* идут
   с заголовком x-tg-initdata; сервер проверяет HMAC и ADMIN_TG_ID. */
(function () {
  var TG = window.Telegram && window.Telegram.WebApp;
  var initData = (TG && TG.initData) || '';
  if (TG) { TG.ready(); TG.expand(); }

  var me = document.getElementById('me');
  try {
    var u = initData ? JSON.parse(new URLSearchParams(initData).get('user') || '{}') : {};
    me.textContent = u.first_name ? (u.first_name + (u.username ? ' · @' + u.username : '')) : 'админ';
  } catch (e) { me.textContent = 'админ'; }

  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg, err) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', !!err);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  async function api(path, body) {
    var opt = { method: 'GET', headers: { 'x-tg-initdata': initData } };
    if (body !== undefined) {
      opt.method = 'POST';
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    var r = await fetch('/api/admin' + path, opt);
    var data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((data && (data.message || data.error)) || ('HTTP ' + r.status));
    return data;
  }

  // Табы
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.toggle('active', x === t); });
      panels.forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab); });
    });
  });

  // Форматирование даты
  function fmt(iso) { return iso ? new Date(iso).toLocaleDateString('ru-RU') : '—'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ── тарифы (нужны для select'а выдачи и для вкладки) ── */
  var PLANS = [];
  async function loadPlans() {
    var data = await api('/plans');
    PLANS = data.plans;
    var sel = document.getElementById('g-plan');
    sel.innerHTML = PLANS.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.title) + ' — ' + p.priceRub.toLocaleString('ru-RU') + ' ₽</option>';
    }).join('');
    renderPlans();
  }
  function renderPlans() {
    var box = document.getElementById('p-list');
    box.innerHTML = PLANS.map(function (p) {
      return '<div class="card" data-plan="' + esc(p.id) + '">' +
        '<h3>Тариф «' + esc(p.title) + '» <span class="pill">' + esc(p.id) + '</span></h3>' +
        '<div class="row"><div><label>Название</label><input data-k="title" value="' + esc(p.title) + '"></div>' +
        '<div><label>Цена, ₽</label><input data-k="priceRub" type="number" value="' + p.priceRub + '"></div></div>' +
        '<div class="row"><div><label>Дней</label><input data-k="days" type="number" value="' + p.days + '"></div>' +
        '<div><label>Бейдж</label><input data-k="badge" value="' + esc(p.badge) + '"></div></div>' +
        '<label>Описание</label><textarea data-k="description">' + esc(p.description) + '</textarea>' +
        '<button class="btn primary sm" data-act="save" style="margin-top:10px">Сохранить</button>' +
        '</div>';
    }).join('');
  }
  document.getElementById('p-list').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act="save"]');
    if (!b) return;
    var card = b.closest('[data-plan]');
    var id = card.getAttribute('data-plan');
    var body = { id: id };
    card.querySelectorAll('[data-k]').forEach(function (inp) {
      var k = inp.getAttribute('data-k');
      body[k] = k === 'priceRub' || k === 'days' ? Number(inp.value) : inp.value;
    });
    b.disabled = true;
    try {
      var data = await api('/plan', body);
      var idx = PLANS.findIndex(function (p) { return p.id === id; });
      if (idx >= 0) PLANS[idx] = data.plan;
      renderPlans(); loadPlans();
      toast('Тариф «' + data.plan.title + '» сохранён');
    } catch (err) { toast(err.message, true); }
    finally { b.disabled = false; }
  });
  document.getElementById('p-reset').addEventListener('click', async function () {
    if (!confirm('Сбросить все тарифы к стандартным? Текущие цены и описания будут потеряны.')) return;
    try {
      var data = await api('/plans/reset', {});
      PLANS = data.plans;
      renderPlans();
      var sel = document.getElementById('g-plan');
      sel.innerHTML = PLANS.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.title) + ' — ' + p.priceRub.toLocaleString('ru-RU') + ' ₽</option>';
      }).join('');
      toast('Тарифы сброшены к стандартным');
    } catch (err) { toast(err.message, true); }
  });

  /* ── пользователи ── */
  var USERS = [];
  async function loadUsers() {
    var data = await api('/users');
    USERS = data.users;
    renderUsers();
  }
  function renderUsers() {
    var q = (document.getElementById('u-search').value || '').trim().toLowerCase();
    var list = USERS.filter(function (u) {
      if (!q) return true;
      return String(u.tgId).includes(q) || (u.username || '').toLowerCase().includes(q) ||
        (u.firstName || '').toLowerCase().includes(q);
    });
    var box = document.getElementById('u-list');
    if (!list.length) { box.innerHTML = '<div class="empty">Никого не найдено. Пользователь должен сначала войти в кабинет через бота.</div>'; return; }
    box.innerHTML = list.map(function (u) {
      var on = u.active;
      return '<div class="card" data-tg="' + u.tgId + '">' +
        '<div class="uhead"><span class="name">' + esc(u.firstName || 'без имени') + '</span>' +
        '<span class="sub">@' + esc(u.username || '—') + ' <span class="pill">id ' + u.tgId + '</span></span></div>' +
        '<div class="ustatus ' + (on ? 'on' : 'off') + '">' +
        (on ? '✅ Подписка до ' + fmt(u.subscriptionUntil) + (u.planId ? ' · ' + esc(u.planId) : '') : '⬜ нет подписки') + '</div>' +
        '<div class="grid2">' +
        '<button class="btn primary sm" data-act="g" data-plan="pro" data-days="30">PRO 30д</button>' +
        '<button class="btn primary sm" data-act="g" data-plan="month" data-days="30">База 30д</button>' +
        '<button class="btn primary sm" data-act="g" data-plan="pro" data-days="90">PRO 90д</button>' +
        '<button class="btn danger sm" data-act="r">Снять</button>' +
        '</div></div>';
    }).join('');
  }
  document.getElementById('u-search').addEventListener('input', renderUsers);
  document.getElementById('u-list').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var card = b.closest('[data-tg]');
    var tgId = Number(card.getAttribute('data-tg'));
    b.disabled = true;
    try {
      if (b.dataset.act === 'g') {
        var data = await api('/grant', { tgId: tgId, days: Number(b.dataset.days), planId: b.dataset.plan });
        var idx = USERS.findIndex(function (u) { return u.tgId === tgId; });
        if (idx >= 0) USERS[idx] = data.user;
        renderUsers();
        toast('✅ Выдано ' + b.dataset.plan.toUpperCase() + ' ' + b.dataset.days + ' дн.');
      } else if (b.dataset.act === 'r') {
        if (!confirm('Снять подписку у этого пользователя?')) return;
        var d2 = await api('/revoke', { tgId: tgId });
        var i2 = USERS.findIndex(function (u) { return u.tgId === tgId; });
        if (i2 >= 0) USERS[i2] = d2.user;
        renderUsers();
        toast('🚫 Подписка снята');
      }
    } catch (err) { toast(err.message, true); }
    finally { b.disabled = false; }
  });

  // Выдача по Telegram ID (форма)
  document.getElementById('g-go').addEventListener('click', async function () {
    var tgId = Number(document.getElementById('g-tgid').value);
    var days = Number(document.getElementById('g-days').value);
    var planId = document.getElementById('g-plan').value;
    if (!Number.isInteger(tgId) || tgId <= 0) { toast('Введите числовой Telegram ID', true); return; }
    if (!(days > 0 && days <= 3650)) { toast('Дней: 1–3650', true); return; }
    var b = this; b.disabled = true;
    try {
      var data = await api('/grant', { tgId: tgId, days: days, planId: planId });
      var idx = USERS.findIndex(function (u) { return u.tgId === tgId; });
      if (idx >= 0) USERS[idx] = data.user; else await loadUsers();
      renderUsers();
      toast('✅ Выдано ' + planId.toUpperCase() + ' ' + days + ' дн. до ' + fmt(data.user.subscriptionUntil));
    } catch (err) { toast(err.message, true); }
    finally { b.disabled = false; }
  });

  /* ── обучение ── */
  var LESSONS = [];
  async function loadTraining() {
    var data = await api('/training');
    LESSONS = data.lessons;
    renderTraining();
  }
  function renderTraining() {
    var box = document.getElementById('t-list');
    if (!LESSONS.length) { box.innerHTML = '<div class="empty">Уроков пока нет. Добавьте первый выше.</div>'; return; }
    box.innerHTML = LESSONS.map(function (l) {
      return '<div class="card" data-id="' + esc(l.id) + '">' +
        '<input data-k="title" value="' + esc(l.title) + '">' +
        '<label>Текст</label><textarea data-k="body">' + esc(l.body) + '</textarea>' +
        '<div class="row" style="margin-top:10px">' +
        '<button class="btn primary sm" data-act="save">Сохранить</button>' +
        '<button class="btn danger sm" data-act="del">Удалить</button></div></div>';
    }).join('');
  }
  document.getElementById('t-add').addEventListener('click', async function () {
    var title = document.getElementById('t-title').value.trim();
    var body = document.getElementById('t-body').value;
    if (!title) { toast('Укажите заголовок', true); return; }
    var b = this; b.disabled = true;
    try {
      var data = await api('/training/save', { title: title, body: body });
      LESSONS.unshift(data.lesson);
      renderTraining();
      document.getElementById('t-title').value = '';
      document.getElementById('t-body').value = '';
      toast('Урок добавлен');
    } catch (err) { toast(err.message, true); }
    finally { b.disabled = false; }
  });
  document.getElementById('t-list').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var card = b.closest('[data-id]');
    var id = card.getAttribute('data-id');
    if (b.dataset.act === 'del') {
      if (!confirm('Удалить урок?')) return;
      b.disabled = true;
      try { await api('/training/delete', { id: id }); LESSONS = LESSONS.filter(function (l) { return l.id !== id; }); renderTraining(); toast('Урок удалён'); }
      catch (err) { toast(err.message, true); } finally { b.disabled = false; }
      return;
    }
    if (b.dataset.act === 'save') {
      var body = { id: id };
      card.querySelectorAll('[data-k]').forEach(function (inp) { body[inp.getAttribute('data-k')] = inp.value; });
      b.disabled = true;
      try {
        var data = await api('/training/save', body);
        var idx = LESSONS.findIndex(function (l) { return l.id === id; });
        if (idx >= 0) LESSONS[idx] = data.lesson;
        renderTraining();
        toast('Урок сохранён');
      } catch (err) { toast(err.message, true); }
      finally { b.disabled = false; }
    }
  });

  /* ── старт ── */
  (async function init() {
    if (!initData) {
      me.textContent = 'нет доступа';
      toast('Откройте панель через бота командой /admin', true);
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      return;
    }
    try {
      await api('/me');
      await Promise.all([loadPlans(), loadUsers(), loadTraining()]);
    } catch (err) {
      toast(err.message, true);
    }
  })();
})();
