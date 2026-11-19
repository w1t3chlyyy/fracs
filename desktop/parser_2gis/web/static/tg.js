/* Панель «Telegram» в дашборде Fracs Parser: поиск свежих сообщений людей, которым что-то нужно. */
(function () {
  var content = document.querySelector('.content');
  if (!content) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var safeUrl = function (u) { u = (u == null ? '' : String(u)).trim(); return /^(https?:\/\/|tg:\/\/)/i.test(u) ? u : '#'; };
  var rows = [];

  var box = document.createElement('details');
  box.className = 'log'; box.id = 'tgbox';
  box.innerHTML =
    '<summary>✈️ Telegram: люди, которым это нужно</summary>' +
    '<div style="padding:14px 16px;border-top:1px solid var(--line)">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<input id="tgPhrase" maxlength="120" placeholder="Что ищут: «нужен сайт», «ищу бухгалтера»…" style="flex:1;min-width:220px">' +
    '<select id="tgDays" style="width:auto"><option value="1">За 1 день</option><option value="2">За 2 дня</option><option value="3" selected>За 3 дня</option></select>' +
    '<button id="tgGo" class="btn-run" style="flex:none">Найти людей</button>' +
    '<button id="tgCsv" class="btn-clear" style="display:none">⬇ CSV</button></div>' +
    '<div class="hint" id="tgMsg" style="margin-top:8px">Свежие сообщения (до 3 дней) в публичных группах Telegram: автор, чат, текст и ссылка, чтобы написать человеку.</div>' +
    '<div class="grid" id="tgGrid" style="margin-top:14px"></div></div>';
  content.insertBefore(box, content.firstChild);

  var $ = function (id) { return document.getElementById(id); };

  function render() {
    $('tgGrid').innerHTML = rows.map(function (r) {
      var d = r.date ? new Date(r.date).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      return '<article class="card"><div class="card-head"><h2>' + esc(r.name) + (r.username ? ' <span style="font-weight:400;color:var(--muted)">@' + esc(r.username) + '</span>' : '') + '</h2>' +
        '<span class="meta">' + esc(d) + '</span></div>' +
        '<div class="meta">' + esc(r.chat) + '</div>' +
        '<div style="font-size:13.5px;line-height:1.45;white-space:pre-wrap">' + esc(r.text.length > 400 ? r.text.slice(0, 400) + '…' : r.text) + '</div>' +
        '<div class="acts"><a class="b tg" target="_blank" rel="noopener" href="' + esc(safeUrl(r.link)) + '">Написать</a></div></article>';
    }).join('');
    $('tgCsv').style.display = rows.length ? '' : 'none';
  }

  $('tgGo').addEventListener('click', function () {
    var phrase = $('tgPhrase').value.trim();
    if (phrase.length < 3) { $('tgMsg').textContent = 'Опишите, что ищут: например, «нужен сайт».'; return; }
    var btn = $('tgGo'); btn.disabled = true; btn.textContent = 'Ищем…';
    $('tgMsg').textContent = 'Поиск идёт до 40 секунд…';
    fetch('/api/tg/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phrase: phrase, days: parseInt($('tgDays').value, 10) }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { $('tgMsg').textContent = d.error === 'license' ? 'Подписка закончилась.' : (d.error || 'Ошибка поиска'); return; }
        rows = d.rows || []; render();
        $('tgMsg').textContent = rows.length ? 'Найдено: ' + rows.length : 'Ничего свежего не нашлось — попробуйте другую формулировку.';
      })
      .catch(function () { $('tgMsg').textContent = 'Нет связи с программой.'; })
      .then(function () { btn.disabled = false; btn.textContent = 'Найти людей'; });
  });
  $('tgPhrase').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('tgGo').click(); });

  $('tgCsv').addEventListener('click', function () {
    var cell = function (v) { var s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    var cols = [['Username', 'username'], ['Имя', 'name'], ['Чат', 'chat'], ['Сообщение', 'text'], ['Дата', 'date'], ['Ссылка', 'link']];
    var csv = '\uFEFF' + [cols.map(function (c) { return cell(c[0]); }).join(';')].concat(rows.map(function (r) { return cols.map(function (c) { return cell(r[c[1]]); }).join(';'); })).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'telegram-leads.csv'; document.body.appendChild(a); a.click(); a.remove();
  });
})();
