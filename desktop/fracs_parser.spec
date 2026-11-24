# -*- mode: python ; coding: utf-8 -*-
# Сборка:  pyinstaller fracs_parser.spec   (результат: dist/FracsParser/)
import sys

datas = [
    ('parser_2gis/data', 'parser_2gis/data'),
    ('parser_2gis/web/static', 'parser_2gis/web/static'),
]
a = Analysis(
    ['fracs_parser.py'],
    pathex=['.'],
    datas=datas,
    hiddenimports=['qrcode', 'PIL', 'flask', 'xlsxwriter', 'pychrome', 'websocket', 'psutil', 'requests', 'pydantic'],
    excludes=['tkinter', 'pytest'],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='FracsParser',
    console=True,  # окно консоли нужно: в нём видно адрес дашборда и ошибки; закрыть окно = остановить программу
    icon='parser_2gis/data/images/icon.ico' if sys.platform == 'win32' else ('parser_2gis/data/images/icon.icns' if sys.platform == 'darwin' else None),
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, name='FracsParser')
