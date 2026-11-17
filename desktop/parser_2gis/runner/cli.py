from __future__ import annotations

from .. import license as fracs_license
from ..exceptions import ChromeRuntimeException, ChromeUserAbortException
from ..logger import logger
from ..parser import get_parser
from ..writer import get_writer
from .runner import AbstractRunner


class _LicenseWriter:
    def __init__(self, inner):
        self._inner = inner

    def __enter__(self):
        self._inner.__enter__()
        return self

    def __exit__(self, *exc_info):
        return self._inner.__exit__(*exc_info)

    def write(self, doc):
        if not fracs_license.check().get('ok'):
            raise RuntimeError('Подписка закончилась. Работа программы остановлена.')
        self._inner.write(doc)


class CLIRunner(AbstractRunner):
    """CLI runner.

    Args:
        urls: 2GIS URLs with items to be collected.
        output_path: Path to the result file.
        format: `csv`, `xlsx` or `json` format.
        config: Configuration.
    """
    def start(self):
        logger.info('Парсинг запущен.')
        try:
            with get_writer(self._output_path, self._format, self._config.writer,
                            self._config.filters) as raw_writer:
                writer = _LicenseWriter(raw_writer)
                for url in self._urls:
                    if not fracs_license.check().get('ok'):
                        raise RuntimeError('Подписка закончилась. Работа программы остановлена.')
                    logger.info(f'Парсинг ссылки {url}')
                    with get_parser(url,
                                    chrome_options=self._config.chrome,
                                    parser_options=self._config.parser) as parser:
                        try:
                            parser.parse(writer)
                        finally:
                            logger.info('Парсинг ссылки завершён.')
        except (KeyboardInterrupt, ChromeUserAbortException):
            logger.error('Работа парсера прервана пользователем.')
        except Exception as e:
            if isinstance(e, ChromeRuntimeException) and str(e) == 'Tab has been stopped':
                logger.error('Вкладка браузера была закрыта.')
            else:
                logger.error('Ошибка во время работы парсера: %s', e)
        finally:
            logger.info('Парсинг завершён.')

    def stop(self):
        pass
