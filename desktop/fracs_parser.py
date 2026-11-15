"""Fracs Parser — запуск программы: поднимает локальный дашборд и открывает его в браузере."""
import multiprocessing
import socket
import sys


def _free_port(start: int = 8666) -> int:
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return start


def main() -> None:
    # С аргументами (-i/-o/-f) работает консольный режим оригинального парсера.
    if len(sys.argv) > 1:
        from parser_2gis.main import main as cli
        return cli()

    from parser_2gis.chrome.utils import locate_chrome_path
    from parser_2gis.web.server import run_server

    if not locate_chrome_path():
        print('Не найден Google Chrome или Microsoft Edge. Установите Chrome: https://www.google.com/chrome/')
    port = _free_port()
    print(f'Fracs Parser запущен: http://127.0.0.1:{port}/  (закройте это окно, чтобы остановить программу)')
    run_server(port=port, open_browser=True)


if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
