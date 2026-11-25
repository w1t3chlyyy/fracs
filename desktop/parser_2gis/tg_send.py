"""Рассылка открыток из Telegram-аккаунтов пользователя (тариф Ultra, код 'tg_broadcast').

Аккаунт привязывается один раз (api_id/api_hash с my.telegram.org + код из Telegram),
после этого программа отправляет открытку (PNG) с подписью выбранным получателям.
Сессии хранятся ЛОКАЛЬНО в профиле пользователя и никуда не отправляются.

Защита аккаунта от блокировки (Telegram жёстко банит за массовые холодные сообщения):
  • суточный лимит на аккаунт (по умолчанию 25, не больше 50) и лимит в час (8);
  • случайная пауза 35–95 с между сообщениями;
  • один и тот же получатель не получает открытку дважды;
  • FloodWait — ждём, если короткий; длинный или PeerFlood — рассылка останавливается,
    аккаунт помечается «ограничен».
Это снижает риск, но не убирает его: пишите тем, кому вы вправе писать, и со вторичных
аккаунтов. Ответственность за рассылку лежит на пользователе.
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import re
import secrets
import threading
import time
from typing import Any

from .paths import user_path

FEATURE = 'tg_broadcast'
DEFAULT_DAILY = 25
MAX_DAILY = 50
MAX_HOURLY = 8
DELAY_RANGE = (35.0, 95.0)
MAX_RECIPIENTS_PER_TASK = 100
_LONG_FLOOD_S = 120

_lock = threading.RLock()
_tasks: dict[str, dict] = {}
_pending: dict[str, dict] = {}          # логины, ожидающие код: login_id → {client, phone, hash, ...}

# ── отдельный event loop для Telethon (Flask-потоки не должны делить свой) ─────

_loop: asyncio.AbstractEventLoop | None = None


def _get_loop() -> asyncio.AbstractEventLoop:
    global _loop
    with _lock:
        if _loop is None:
            _loop = asyncio.new_event_loop()
            threading.Thread(target=_loop.run_forever, daemon=True, name='tg-send-loop').start()
        return _loop


def _run(coro, timeout: float = 90):
    return asyncio.run_coroutine_threadsafe(coro, _get_loop()).result(timeout)


# ── доступ по тарифу ──────────────────────────────────────────────────────────

def access() -> dict:
    try:
        from . import license as lic
        st = lic.check()
    except Exception:
        return {'allowed': False, 'reason': 'Лицензия недоступна.'}
    if not st.get('ok'):
        return {'allowed': False, 'reason': 'Подписка Fracs не активна.'}
    feats = [str(f).lower() for f in (st.get('features') or [])]
    if FEATURE in feats:
        return {'allowed': True, 'reason': ''}
    return {'allowed': False, 'reason': 'Рассылка открыток в Telegram доступна на тарифе Ultra.'}


# ── хранилище ─────────────────────────────────────────────────────────────────

def _file():
    d = user_path()
    d.mkdir(parents=True, exist_ok=True)
    return d / 'tg_accounts.json'


def _load() -> dict:
    try:
        data = json.loads(_file().read_text(encoding='utf-8'))
        data.setdefault('accounts', [])
        data.setdefault('sent', {})
        return data
    except (OSError, ValueError):
        return {'accounts': [], 'sent': {}}


def _save(data: dict) -> None:
    f = _file()
    tmp = f.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    try:
        os.chmod(tmp, 0o600)          # сессия = доступ к аккаунту
    except OSError:
        pass
    os.replace(tmp, f)


def _public(acc: dict, data: dict) -> dict:
    sent = data['sent'].get(acc['id'], [])
    now = time.time()
    return {'id': acc['id'], 'label': acc.get('label') or acc.get('phone'),
            'phone': acc.get('phone'), 'status': acc.get('status', 'ok'),
            'daily_cap': acc.get('daily_cap', DEFAULT_DAILY),
            'sent_24h': sum(1 for s in sent if now - s['ts'] < 86400),
            'sent_1h': sum(1 for s in sent if now - s['ts'] < 3600)}


def list_accounts() -> list[dict]:
    data = _load()
    return [_public(a, data) for a in data['accounts']]


def delete_account(acc_id: str) -> bool:
    with _lock:
        data = _load()
        n = len(data['accounts'])
        data['accounts'] = [a for a in data['accounts'] if a['id'] != acc_id]
        data['sent'].pop(acc_id, None)
        _save(data)
        return len(data['accounts']) < n


def set_daily_cap(acc_id: str, cap: int) -> None:
    with _lock:
        data = _load()
        for a in data['accounts']:
            if a['id'] == acc_id:
                a['daily_cap'] = max(1, min(MAX_DAILY, int(cap)))
        _save(data)


# ── вход в аккаунт ────────────────────────────────────────────────────────────

def _client(session: str, api_id: int, api_hash: str):
    from telethon import TelegramClient
    from telethon.sessions import StringSession
    return TelegramClient(StringSession(session), api_id, api_hash, loop=_get_loop())


def login_start(api_id: Any, api_hash: str, phone: str) -> dict:
    try:
        api_id = int(api_id)
    except (TypeError, ValueError):
        return {'ok': False, 'error': 'api_id — число с my.telegram.org'}
    api_hash, phone = (api_hash or '').strip(), re.sub(r'[^\d+]', '', phone or '')
    if len(api_hash) < 16 or len(phone) < 8:
        return {'ok': False, 'error': 'Проверьте api_hash и номер телефона (в формате +7…).'}
    try:
        import telethon  # noqa: F401
    except ImportError:
        return {'ok': False, 'error': 'Не установлен telethon (pip install telethon).'}

    async def go():
        c = _client('', api_id, api_hash)
        await c.connect()
        sent = await c.send_code_request(phone)
        return c, sent.phone_code_hash

    try:
        c, h = _run(go())
    except Exception as e:
        return {'ok': False, 'error': f'Telegram: {type(e).__name__}: {e}'}
    login_id = secrets.token_urlsafe(8)
    with _lock:
        _pending[login_id] = {'client': c, 'phone': phone, 'hash': h, 'api_id': api_id,
                              'api_hash': api_hash, 'at': time.time()}
        for k in [k for k, v in _pending.items() if time.time() - v['at'] > 900]:
            _pending.pop(k, None)
    return {'ok': True, 'login_id': login_id}


def login_confirm(login_id: str, code: str, password: str = '') -> dict:
    with _lock:
        p = _pending.get(login_id)
    if not p:
        return {'ok': False, 'error': 'Вход устарел — начните заново.'}
    from telethon.errors import PhoneCodeInvalidError, SessionPasswordNeededError

    async def go():
        c = p['client']
        try:
            await c.sign_in(p['phone'], re.sub(r'\D', '', code or ''), phone_code_hash=p['hash'])
        except SessionPasswordNeededError:
            if not password:
                return {'need_password': True}
            await c.sign_in(password=password)
        me = await c.get_me()
        session = c.session.save()
        await c.disconnect()
        return {'session': session, 'me': me}

    try:
        res = _run(go())
    except PhoneCodeInvalidError:
        return {'ok': False, 'error': 'Неверный код.'}
    except Exception as e:
        return {'ok': False, 'error': f'Telegram: {type(e).__name__}: {e}'}
    if res.get('need_password'):
        return {'ok': False, 'need_password': True, 'error': 'Включена двухфакторная защита — введите пароль.'}
    me = res['me']
    label = ('@' + me.username) if getattr(me, 'username', None) else (getattr(me, 'first_name', '') or p['phone'])
    with _lock:
        data = _load()
        data['accounts'] = [a for a in data['accounts'] if a.get('phone') != p['phone']]
        data['accounts'].append({'id': secrets.token_urlsafe(6), 'label': label, 'phone': p['phone'],
                                 'api_id': p['api_id'], 'api_hash': p['api_hash'],
                                 'session': res['session'], 'status': 'ok',
                                 'daily_cap': DEFAULT_DAILY, 'created': time.time()})
        _save(data)
        _pending.pop(login_id, None)
    return {'ok': True, 'accounts': list_accounts()}


# ── рассылка ──────────────────────────────────────────────────────────────────

def parse_recipients(lines: list[str]) -> list[tuple[str, str]]:
    """«@user», «t.me/user», «https://t.me/user | Название» → [(username, название)]."""
    out, seen = [], set()
    for raw in lines or []:
        raw = str(raw).strip()
        if not raw:
            continue
        target, _, company = raw.partition('|')
        m = (re.search(r'(?:t\.me|telegram\.me)/([A-Za-z][A-Za-z0-9_]{3,31})', target)
             or re.match(r'^@([A-Za-z][A-Za-z0-9_]{3,31})$', target.strip()))   # голое слово без @ — не username
        if not m:
            continue
        u = m.group(1).lower()
        if u in seen or u.endswith('bot'):        # ботам открытки не шлём
            continue
        seen.add(u)
        out.append((u, company.strip()))
    return out[:MAX_RECIPIENTS_PER_TASK]


def start_send(account_id: str, png_path: str, recipients: list[str], texts: list[str]) -> dict:
    acc = access()
    if not acc['allowed']:
        return {'ok': False, 'error': acc['reason']}
    if not png_path or not os.path.isfile(png_path):
        return {'ok': False, 'error': 'Открытка не найдена — сначала соберите её в AI-агенте.'}
    texts = [t.strip() for t in (texts or []) if t and t.strip()]
    if not texts:
        return {'ok': False, 'error': 'Добавьте хотя бы один текст сообщения.'}
    targets = parse_recipients(recipients)
    if not targets:
        return {'ok': False, 'error': 'Нет корректных получателей (@username или t.me/username).'}
    with _lock:
        data = _load()
        a = next((x for x in data['accounts'] if x['id'] == account_id), None)
        if not a:
            return {'ok': False, 'error': 'Аккаунт не найден.'}
        if any(t['account'] == account_id and t['status'] == 'running' for t in _tasks.values()):
            return {'ok': False, 'error': 'С этого аккаунта уже идёт рассылка.'}
        tid = secrets.token_urlsafe(6)
        task = {'id': tid, 'account': account_id, 'status': 'running', 'total': len(targets),
                'sent': 0, 'failed': 0, 'skipped': 0, 'log': [], 'cancel': threading.Event(),
                'started': time.time()}
        _tasks[tid] = task
    threading.Thread(target=_worker, args=(task, a, png_path, targets, texts), daemon=True).start()
    return {'ok': True, 'task_id': tid, 'total': len(targets)}


def _limits_ok(data: dict, acc: dict) -> str:
    now = time.time()
    sent = data['sent'].get(acc['id'], [])
    if sum(1 for s in sent if now - s['ts'] < 86400) >= min(MAX_DAILY, int(acc.get('daily_cap', DEFAULT_DAILY))):
        return 'Достигнут суточный лимит аккаунта — продолжите завтра.'
    if sum(1 for s in sent if now - s['ts'] < 3600) >= MAX_HOURLY:
        return 'Достигнут лимит в час — продолжите позже.'
    return ''


async def _send_one(acc: dict, username: str, png_path: str, caption: str) -> None:
    c = _client(acc['session'], int(acc['api_id']), acc['api_hash'])
    await c.connect()
    try:
        if not await c.is_user_authorized():
            raise PermissionError('session_expired')
        await c.send_file(username, png_path, caption=caption)
    finally:
        await c.disconnect()


def _log(task: dict, msg: str) -> None:
    task['log'].append(msg)
    del task['log'][:-60]


def _worker(task: dict, acc: dict, png_path: str, targets: list[tuple[str, str]], texts: list[str]) -> None:
    from telethon import errors as te
    try:
        for i, (user, company) in enumerate(targets):
            if task['cancel'].is_set():
                task['status'] = 'stopped'
                _log(task, 'Остановлено пользователем.')
                return
            with _lock:
                data = _load()
                if any(s['to'] == user for s in data['sent'].get(acc['id'], [])):
                    task['skipped'] += 1
                    _log(task, f'@{user}: уже получал открытку — пропуск.')
                    continue
                stop = _limits_ok(data, acc)
            if stop:
                task['status'] = 'stopped'
                _log(task, stop)
                return
            caption = random.choice(texts).replace('{company}', company or '').strip()
            try:
                _run(_send_one(acc, user, png_path, caption), timeout=120)
                with _lock:
                    data = _load()
                    data['sent'].setdefault(acc['id'], []).append({'to': user, 'ts': time.time()})
                    _save(data)
                task['sent'] += 1
                _log(task, f'@{user}: отправлено.')
            except te.FloodWaitError as e:
                if e.seconds > _LONG_FLOOD_S:
                    task['status'] = 'stopped'
                    _log(task, f'Telegram просит подождать {e.seconds} с — рассылка остановлена.')
                    return
                _log(task, f'FloodWait {e.seconds} с — жду.')
                time.sleep(e.seconds + 1)
            except te.PeerFloodError:
                with _lock:
                    data = _load()
                    for a in data['accounts']:
                        if a['id'] == acc['id']:
                            a['status'] = 'limited'
                    _save(data)
                task['status'] = 'stopped'
                _log(task, 'Telegram ограничил аккаунт (PeerFlood). Рассылка остановлена — '
                           'не рассылайте с него несколько дней.')
                return
            except PermissionError:
                task['status'] = 'failed'
                _log(task, 'Сессия аккаунта недействительна — привяжите аккаунт заново.')
                return
            except Exception as e:      # приватность, нет такого пользователя и т.п. — пропускаем
                task['failed'] += 1
                _log(task, f'@{user}: не отправлено ({type(e).__name__}).')
            if i < len(targets) - 1:
                end = time.time() + random.uniform(*DELAY_RANGE)
                while time.time() < end:
                    if task['cancel'].is_set():
                        break
                    time.sleep(0.5)
        task['status'] = 'done'
        _log(task, 'Готово.')
    except Exception as e:  # pragma: no cover
        task['status'] = 'failed'
        _log(task, f'Ошибка: {e}')


def task_state(task_id: str) -> dict | None:
    t = _tasks.get(task_id)
    if not t:
        return None
    return {k: t[k] for k in ('id', 'status', 'total', 'sent', 'failed', 'skipped')} | {'log': t['log'][-15:]}


def cancel(task_id: str) -> bool:
    t = _tasks.get(task_id)
    if t:
        t['cancel'].set()
    return bool(t)
