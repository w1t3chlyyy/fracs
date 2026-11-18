"""Fracs TG-сервис: глобальный поиск СВЕЖИХ сообщений по публичным чатам Telegram (Telethon SearchGlobal).

Контракт (его ждёт server/providers.ts и программа Fracs Parser через сайт):
  POST /search  {phrase, days(1-3), budget(сек)}  +  Authorization: Bearer <TG_PARSER_KEY>
  ->  {rows: [{id, username, name, chat, text, date, link}], scanned: N}
"""
import asyncio
import hashlib
import hmac
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from telethon import TelegramClient, errors
from telethon.sessions import StringSession
from telethon.tl.functions.messages import SearchGlobalRequest
from telethon.tl.types import Channel, InputMessagesFilterEmpty, InputPeerEmpty

API_ID = int(os.environ.get('TG_API_ID', '0') or 0)
API_HASH = os.environ.get('TG_API_HASH', '')
SESSION = os.environ.get('TG_SESSION_STRING', '')
KEY = os.environ.get('TG_PARSER_KEY', '')
PAGE = 50       # максимум Telegram на страницу
MAX_PAGES = 3

app = FastAPI(title='Fracs TG service')
_lock = asyncio.Lock()  # одна сессия не должна работать из двух запросов одновременно

# Человек ищет исполнителя / задаёт вопрос
INTENT = re.compile(
    r'(ищу|ищем|в поисках|нужен|нужна|нужно|нужны|надо|требуется|требуются|посоветуйте|подскажите|'
    r'порекомендуйте|помогите|кто (?:может|сделает|делает|займ\w+|возьм\w+)|сколько стоит|'
    r'где (?:можно )?(?:заказать|найти)|хочу заказать|рассмотрю предложения)', re.I)
# Реклама исполнителей: такие сообщения не лиды
OFFER = re.compile(
    r'(предлагаю|предлагаем|выполню|выполним|делаю|делаем|оказываем|наши услуги|портфолио|под ключ|'
    r'скидк|акци[яи]|наши цены|разработаем|создадим|успейте|закажи(?:те)?\b)', re.I)
STOP = {'ищу', 'ищем', 'нужен', 'нужна', 'нужно', 'нужны', 'надо', 'кто', 'для', 'как', 'что', 'где'}


class Req(BaseModel):
    phrase: str = Field(min_length=3, max_length=120)
    days: int = Field(default=3, ge=1, le=3)
    budget: int = Field(default=35, ge=5, le=55)


def _norm(s: str) -> str:
    return re.sub(r'\W+', ' ', s.lower().replace('ё', 'е')).strip()


def _relevant(text: str, phrase: str) -> bool:
    toks = [w[:5] for w in _norm(phrase).split() if len(w) >= 3 and w not in STOP]
    if not toks:
        return True
    t = _norm(text)
    hit = sum(1 for x in toks if x in t)
    return hit >= math.ceil(len(toks) / 2)


async def _global(client, q, cutoff, rate, peer, mid):
    kw = dict(q=q, filter=InputMessagesFilterEmpty(), min_date=cutoff, max_date=None,
              offset_rate=rate, offset_peer=peer, offset_id=mid, limit=PAGE)
    try:  # в новых слоях можно искать только по группам (в каналах — посты, не заявки)
        req = SearchGlobalRequest(groups_only=True, **kw)
    except TypeError:
        req = SearchGlobalRequest(**kw)
    return await client(req)


async def _search(phrase: str, days: int, budget: int):
    if not (API_ID and API_HASH and SESSION):
        raise HTTPException(503, 'TG_API_ID / TG_API_HASH / TG_SESSION_STRING не заданы')
    deadline = time.monotonic() + budget
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    client = TelegramClient(StringSession(SESSION), API_ID, API_HASH)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise HTTPException(503, 'Сессия Telegram недействительна: сгенерируйте TG_SESSION_STRING заново')
        rows, seen, scanned = [], set(), 0
        rate, peer, mid = 0, InputPeerEmpty(), 0
        for _ in range(MAX_PAGES):
            if time.monotonic() > deadline:
                break
            res = await _global(client, phrase, cutoff, rate, peer, mid)
            msgs = list(res.messages)
            if not msgs:
                break
            scanned += len(msgs)
            chats = {c.id: c for c in res.chats}
            users = {u.id: u for u in res.users}
            for m in msgs:
                text = (getattr(m, 'message', '') or '').strip()
                if not text or m.date < cutoff or not (15 <= len(text) <= 1500):
                    continue
                cid = getattr(m.peer_id, 'channel_id', None) or getattr(m.peer_id, 'chat_id', None)
                chat = chats.get(cid)
                if chat is None or (isinstance(chat, Channel) and chat.broadcast):
                    continue
                uid = getattr(getattr(m, 'from_id', None), 'user_id', None)
                user = users.get(uid)
                if user is None or getattr(user, 'bot', False):
                    continue
                if not INTENT.search(text) or (OFFER.search(text) and not re.match(r'\s*(ищу|нужен|нужна|нужно|подскажите|посоветуйте)', text, re.I)):
                    continue
                if not _relevant(text, phrase):
                    continue
                h = hashlib.md5(_norm(text)[:300].encode()).hexdigest()  # кросс-посты
                if h in seen:
                    continue
                seen.add(h)
                uname = getattr(chat, 'username', None)
                msg_link = f'https://t.me/{uname}/{m.id}' if uname else f'https://t.me/c/{cid}/{m.id}'
                rows.append({
                    'id': f'{cid}:{m.id}',
                    'username': user.username or '',
                    'name': ' '.join(x for x in [user.first_name, user.last_name] if x) or 'Без имени',
                    'chat': getattr(chat, 'title', '') or (f'@{uname}' if uname else 'Чат'),
                    'text': text,
                    'date': m.date.astimezone(timezone.utc).isoformat(),
                    'link': f'https://t.me/{user.username}' if user.username else msg_link,
                })
            nr = getattr(res, 'next_rate', None)
            if len(msgs) < PAGE or not nr:
                break
            try:
                rate, mid = nr, msgs[-1].id
                peer = await client.get_input_entity(msgs[-1].peer_id)
            except Exception:
                break
        rows.sort(key=lambda r: r['date'], reverse=True)
        return rows, scanned
    except errors.FloodWaitError as e:
        raise HTTPException(429, f'Telegram просит подождать {e.seconds} с. Повторите позже')
    except (errors.AuthKeyError, errors.SessionRevokedError, errors.UserDeactivatedError):
        raise HTTPException(503, 'Сессия Telegram сброшена: сгенерируйте TG_SESSION_STRING заново')
    finally:
        await client.disconnect()


@app.get('/health')
async def health():
    return {'ok': True, 'configured': bool(API_ID and API_HASH and SESSION)}


@app.post('/search')
async def search(body: Req, authorization: Optional[str] = Header(None)):
    got = (authorization or '').removeprefix('Bearer ').strip()
    if not KEY or not hmac.compare_digest(got, KEY):
        raise HTTPException(401, 'unauthorized')
    async with _lock:
        rows, scanned = await _search(body.phrase.strip(), body.days, body.budget)
    return {'rows': rows, 'scanned': scanned}
