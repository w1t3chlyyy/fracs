/* Панель «Рассылка открыток в Telegram» (тариф Ultra): привязка аккаунтов и отправка
   открытки из AI-агента. Бэкенд: /api/tgsend/* (tg_routes.register_send → tg_send.py). */
(function () {
  var anchor = document.getElementById('tgLogwrap');
  if (!anchor) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var st = { accounts: [], postcards: [], limits: {}, loginId: '', task: '', timer: 0 };
  var inp = 'style="width:100%;margin-top:4px"';

  var box = document.createElement('details');
  box.className = 'log'; box.id = 'tgsendbox';
  box.innerHTML = '<summary>✈ Рассылка открыток в Telegram <span style="font-weight:400;opacity:.6">· Ultra</span></summary>' +
    '<div id="tsBody" style="padding:14px 16px">Загрузка…</div>';
  anchor.parentNode.insertBefore(box, anchor.nextSibling);

  function api(url, method, body) {
    return fetch(url, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json(); });
  }
  function msg(t) { var m = $('tsMsg'); if (m) m.textContent = t || ''; }

  function render(allowed, reason) {
    var b = $('tsBody');
    if (!allowed) { b.innerHTML = '<div class="tg-hint">' + esc(reason || 'Доступно на тарифе Ultra.') + '</div>'; return; }
    var L = st.limits || {}, dl = L.delay || [35, 95];
    var accs = st.accounts.map(function (a) {
      return '<div style="display:flex;gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap">' +
        '<b>' + esc(a.label) + '</b><span style="opacity:.6">' + esc(a.phone) + '</span>' +
        '<span style="opacity:.6">' + a.sent_24h + ' / ' + a.daily_cap + ' за 24 ч' + (a.status === 'limited' ? ' · <span style="color:#e5484d">ограничен Telegram</span>' : '') + '</span>' +
        '<button class="btn-clear" data-del="' + esc(a.id) + '" style="margin-left:auto">Отвязать</button></div>';
    }).join('') || '<div class="tg-hint">Аккаунтов пока нет.</div>';
    b.innerHTML =
      '<div class="tg-hint" style="margin-bottom:10px">Рассылайте со <b>вторичных</b> аккаунтов и только тем, кому вправе писать: Telegram банит за массовые холодные сообщения. ' +
      'Встроенные ограничения: до ' + L.daily_max + ' в сутки на аккаунт (по умолчанию ' + L.daily_default + '), ' + L.hourly + ' в час, пауза ' + Math.round(dl[0]) + '–' + Math.round(dl[1]) + ' с, без повторов одному получателю. Сессии хранятся только на этом компьютере.</div>' +
      '<div><b>Аккаунты</b>' + accs + '</div>' +
      '<details style="margin:8px 0"><summary style="cursor:pointer;opacity:.8">+ Привязать аккаунт</summary><div style="padding:8px 0">' +
      '<div class="tg-hint">api_id и api_hash — на my.telegram.org → API development tools.</div>' +
      '<input id="tsApiId" placeholder="api_id" ' + inp + '><input id="tsApiHash" placeholder="api_hash" ' + inp + '><input id="tsPhone" placeholder="Телефон: +7…" ' + inp + '>' +
      '<button id="tsCode" class="btn-run" style="margin-top:8px">Получить код</button>' +
      '<div id="tsStep2" style="display:none;margin-top:8px"><input id="tsCodeIn" placeholder="Код из Telegram" ' + inp + '><input id="tsPwd" type="password" placeholder="Пароль 2FA (если включён)" ' + inp + '>' +
      '<button id="tsLogin" class="btn-run" style="margin-top:8px">Войти</button></div></div></details>' +
      '<div style="margin-top:12px"><b>Рассылка</b>' +
      '<select id="tsAcc" ' + inp + '>' + st.accounts.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.label) + '</option>'; }).join('') + '</select>' +
      '<select id="tsCard" ' + inp + '>' + (st.postcards.length ? st.postcards.map(function (c) { return '<option value="' + esc(c.job_id) + '">Открытка: ' + esc(c.title) + '</option>'; }).join('') : '<option value="">Нет открыток — соберите в AI-агенте</option>') + '</select>' +
      '<textarea id="tsTexts" rows="3" ' + inp + ' placeholder="Текст сообщения. Можно {company}. Несколько вариантов — разделите пустой строкой."></textarea>' +
      '<textarea id="tsRcpt" rows="5" ' + inp + ' placeholder="Получатели: @username или t.me/username, по одному в строке (до ' + L.max_recipients + '). Можно «@user | Название»."></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:8px"><button id="tsFill" class="btn-clear">Взять из поиска людей</button><button id="tsGo" class="btn-run" style="flex:none">Начать рассылку</button><button id="tsStop" class="btn-clear" style="display:none">Остановить</button></div></div>' +
      '<div class="tg-hint" id="tsMsg" style="margin-top:8px"></div><pre id="tsLog" style="white-space:pre-wrap;margin-top:6px;opacity:.7"></pre>';
    wire();
  }

  function wire() {
    $('tsBody').querySelectorAll('[data-del]').forEach(function (x) {
      x.addEventListener('click', function () {
        if (!confirm('Отвязать аккаунт? Сессия будет удалена с этого компьютера.')) return;
        api('/api/tgsend/accounts/' + encodeURIComponent(x.getAttribute('data-del')), 'DELETE').then(function () { load(); });
      });
    });
    $('tsCode').addEventListener('click', function () {
      msg('Запрашиваю код…');
      api('/api/tgsend/login/start', 'POST', { api_id: $('tsApiId').value, api_hash: $('tsApiHash').value, phone: $('tsPhone').value }).then(function (d) {
        if (!d.ok) { msg(d.error || 'Ошибка'); return; }
        st.loginId = d.login_id; $('tsStep2').style.display = ''; msg('Код отправлен в Telegram.');
      }).catch(function () { msg('Нет связи с программой.'); });
    });
    $('tsLogin').addEventListener('click', function () {
      api('/api/tgsend/login/confirm', 'POST', { login_id: st.loginId, code: $('tsCodeIn').value, password: $('tsPwd').value }).then(function (d) {
        if (d.ok) { load(); return; }
        msg(d.error || 'Ошибка входа');
      });
    });
    $('tsFill').addEventListener('click', function () {
      var rows = (window.__tgRows || []).filter(function (r) { return r.username; });
      $('tsRcpt').value = rows.map(function (r) { return '@' + r.username; }).join('\n');
      msg(rows.length ? 'Добавлено получателей: ' + rows.length : 'В результатах поиска нет людей с username.');
    });
    $('tsGo').addEventListener('click', function () {
      var texts = $('tsTexts').value.split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (!$('tsCard').value) { msg('Сначала соберите открытку в AI-агенте.'); return; }
      if (!confirm('Начать рассылку? Остановить её можно в любой момент.')) return;
      api('/api/tgsend/send', 'POST', { account_id: $('tsAcc').value, job_id: $('tsCard').value, recipients: $('tsRcpt').value.split('\n'), texts: texts }).then(function (d) {
        if (!d.ok) { msg(d.error || 'Ошибка'); return; }
        st.task = d.task_id; $('tsStop').style.display = ''; $('tsGo').disabled = true; poll();
      });
    });
    $('tsStop').addEventListener('click', function () { if (st.task) api('/api/tgsend/cancel/' + st.task, 'POST'); });
  }

  function poll() {
    clearTimeout(st.timer);
    api('/api/tgsend/status/' + st.task).then(function (d) {
      if (!d.ok) return;
      msg('Статус: ' + d.status + ' · отправлено ' + d.sent + ' из ' + d.total + (d.failed ? ' · ошибок ' + d.failed : '') + (d.skipped ? ' · пропущено ' + d.skipped : ''));
      $('tsLog').textContent = (d.log || []).join('\n');
      if (d.status === 'running') { st.timer = setTimeout(poll, 3000); }
      else { var m = $('tsMsg').textContent, l = $('tsLog').textContent; load(function () { msg(m); $('tsLog').textContent = l; }); }
    });
  }

  function load(after) {
    api('/api/tgsend/state').then(function (d) {
      st.accounts = d.accounts || []; st.postcards = d.postcards || []; st.limits = d.limits || {};
      render(d.allowed, d.reason);
      if (typeof after === 'function') after();
    }).catch(function () { $('tsBody').textContent = 'Нет связи с программой.'; });
  }
  box.addEventListener('toggle', function () { if (box.open) load(); });
})();
