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
  var IC = {
    ok:   '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    ban:  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    none: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>'
  };
  function toast(msg, err) {
    toastEl.innerHTML = (err ? IC.ban : IC.ok) + '<span>' + esc(msg) + '</span>';
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
      return String(u.tgId || '').includes(q) || (u.username || '').toLowerCase().includes(q) ||
        (u.firstName || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
    });
    var box = document.getElementById('u-list');
    if (!list.length) { box.innerHTML = '<div class="empty">Никого не найдено. Пользователь должен сначала войти в кабинет (бот или код с почты).</div>'; return; }
    box.innerHTML = list.map(function (u) {
      var on = u.active;
      var isEmail = u.tgId == null || u.tgId === 0;
      var ident = isEmail
        ? '<span class="sub"><span class="pill">почта</span> ' + esc(u.email || '—') + '</span>'
        : '<span class="sub">@' + esc(u.username || '—') + ' <span class="pill">id ' + u.tgId + '</span></span>';
      return '<div class="card" data-uid="' + esc(u.id) + '">' +
        '<div class="uhead"><span class="name">' + esc(u.firstName || 'без имени') + '</span>' + ident + '</div>' +
        '<div class="ustatus ' + (on ? 'on' : 'off') + '">' +
        (on ? IC.ok + '<span>Подписка до ' + fmt(u.subscriptionUntil) + (u.planId ? ' · ' + esc(u.planId) : '') + '</span>' : IC.none + '<span>нет подписки</span>') + '</div>' +
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
    var card = b.closest('[data-uid]');
    var uid = card.getAttribute('data-uid');
    var idx = USERS.findIndex(function (u) { return u.id === uid; });
    b.disabled = true;
    try {
      if (b.dataset.act === 'g') {
        var data = await api('/grant', { id: uid, days: Number(b.dataset.days), planId: b.dataset.plan });
        if (idx >= 0) USERS[idx] = data.user;
        renderUsers();
        toast('Выдано ' + b.dataset.plan.toUpperCase() + ' ' + b.dataset.days + ' дн.');
      } else if (b.dataset.act === 'r') {
        if (!confirm('Снять подписку у этого пользователя?')) return;
        var d2 = await api('/revoke', { id: uid });
        if (idx >= 0) USERS[idx] = d2.user;
        renderUsers();
        toast('Подписка снята');
      }
    } catch (err) { toast(err.message, true); }
    finally { b.disabled = false; }
  });

  // Выдача по Telegram ID или email (форма)
  document.getElementById('g-go').addEventListener('click', async function () {
    var who = (document.getElementById('g-who').value || '').trim();
    var days = Number(document.getElementById('g-days').value);
    var planId = document.getElementById('g-plan').value;
    var isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(who.toLowerCase());
    var isTg = /^\d+$/.test(who) && Number(who) > 0;
    if (!isEmail && !isTg) { toast('Введите числовой Telegram ID или адрес эл. почты', true); return; }
    if (!(days > 0 && days <= 3650)) { toast('Дней: 1–3650', true); return; }
    var b = this; b.disabled = true;
    try {
      var body = isEmail ? { email: who.toLowerCase(), days: days, planId: planId } : { tgId: Number(who), days: days, planId: planId };
      var data = await api('/grant', body);
      var idx = USERS.findIndex(function (u) { return u.id === data.user.id; });
      if (idx >= 0) USERS[idx] = data.user; else await loadUsers();
      renderUsers();
      toast('Выдано ' + planId.toUpperCase() + ' ' + days + ' дн. до ' + fmt(data.user.subscriptionUntil));
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

  /* ── каналы ── */
  var CHANNELS = [];
  async function loadChannels() {
    var data = await api('/channels');
    CHANNELS = (data.channels || []).slice();
    if (!CHANNELS.length) CHANNELS = [''];
    renderChannels();
  }
  function renderChannels() {
    var box = document.getElementById('ch-list');
    box.innerHTML = CHANNELS.map(function (ch, i) {
      return '<div class="row ch-row" data-i="' + i + '" style="align-items:flex-start;margin-bottom:6px">' +
        '<input class="ch-in" value="' + esc(ch) + '" placeholder="@username или -100…">' +
        '<button class="btn sm ch-check" data-act="check">Проверить</button>' +
        '<button class="btn danger sm ch-del" data-act="del" style="flex:0 0 auto">×</button></div>' +
        '<div class="ch-status" style="font-size:12px;color:var(--muted);margin:-2px 0 10px"></div>';
    }).join('');
  }
  document.getElementById('ch-list').addEventListener('input', function (e) {
    var row = e.target.closest('.ch-row'); if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    CHANNELS[i] = e.target.value;
  });
  document.getElementById('ch-list').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var row = b.closest('.ch-row'); if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    var status = row.nextElementSibling;
    if (b.dataset.act === 'del') {
      CHANNELS.splice(i, 1);
      if (!CHANNELS.length) CHANNELS = [''];
      renderChannels();
      return;
    }
    if (b.dataset.act === 'check') {
      var id = (row.querySelector('.ch-in').value || '').trim();
      if (!id) { toast('Введите канал', true); return; }
      b.disabled = true; status.textContent = 'Проверяем…';
      try {
        var info = await api('/channels/check', { id: id });
        if (info.ok) {
          status.innerHTML = esc(info.title || id) + (info.username ? ' · ' + esc(info.username) : '') +
            ' · тип: ' + esc(info.type || '?') +
            (info.botIsAdmin ? ' · <span style="color:var(--accent)">✓ бот-админ</span>' : ' · <span style="color:var(--danger)">✗ бот не админ</span>');
        } else {
          status.innerHTML = '<span style="color:var(--danger)">✗ ' + esc(info.error || 'не найден') + '</span>';
        }
      } catch (err) { status.innerHTML = '<span style="color:var(--danger)">✗ ' + esc(err.message) + '</span>'; }
      finally { b.disabled = false; }
    }
  });
  document.getElementById('ch-add').addEventListener('click', function () {
    CHANNELS.push(''); renderChannels();
    var rows = document.querySelectorAll('.ch-row');
    var last = rows[rows.length - 1]; if (last) last.querySelector('.ch-in').focus();
  });
  document.getElementById('ch-save').addEventListener('click', async function () {
    var list = CHANNELS.map(function (s) { return (s || '').trim(); }).filter(Boolean);
    var b = this; b.disabled = true;
    try {
      var data = await api('/channels', { channels: list });
      CHANNELS = data.channels.length ? data.channels.slice() : [''];
      renderChannels();
      toast('Каналы сохранены: ' + data.channels.length);
    } catch (err) { toast(err.message, true); }
    finally { b.disabled = false; }
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
      await Promise.all([loadPlans(), loadUsers(), loadTraining(), loadChannels()]);
    } catch (err) {
      toast(err.message, true);
    }
  })();
})();
