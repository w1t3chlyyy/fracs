"""One-time local setup: python scripts/gen-tg-session.py -> TG_SESSION_STRING.

Use a separate Telegram account for the parser.
"""
from telethon.sessions import StringSession
from telethon.sync import TelegramClient

api_id = int(input('api_id (my.telegram.org): ').strip())
api_hash = input('api_hash: ').strip()
with TelegramClient(StringSession(), api_id, api_hash) as client:  # спросит телефон и код
    print('\nTG_SESSION_STRING=' + client.session.save())
