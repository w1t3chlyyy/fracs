"""Один раз локально: python tools/gen_session.py -> строка TG_SESSION_STRING. Используйте ОТДЕЛЬНЫЙ аккаунт."""
from telethon.sessions import StringSession
from telethon.sync import TelegramClient

api_id = int(input('api_id (my.telegram.org): ').strip())
api_hash = input('api_hash: ').strip()
with TelegramClient(StringSession(), api_id, api_hash) as client:  # спросит телефон и код
    print('\nTG_SESSION_STRING=' + client.session.save())
