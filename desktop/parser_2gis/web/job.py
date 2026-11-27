from __future__ import annotations

import logging
import threading
from typing import Any, Optional

from ..config import Configuration
from ..logger import logger
from ..parser import get_parser
from ..writer import FilterWriter, get_writer
from ..writer.filters import any_filter_enabled
from ..writer.record import extract_record
from ..writer.writers import FileWriter
from .. import license as fracs_license
from ..yandex import YandexCaptcha, YandexMaps
from ..owners import Owners, OwnersCaptcha
from .history import History

class LicenseExpiredError(RuntimeError):
    """Подписка закончилась во время выполнения задачи."""

# Keep at most this many log lines in memory for the live progress panel.
_MAX_LOG_LINES = 5000


class CollectorWriter(FileWriter):
    """In-memory writer: collects raw catalog documents (no file output).

    Used by the web dashboard so results can be rendered as cards and later
    exported to any format on demand.
    """
    def __init__(self, writer_options, require_license: bool = True) -> None:
        super().__init__('', writer_options)
        self._require_license = require_license
        self.docs: list[Any] = []
        # District/sheet label for the URL currently being parsed; kept aligned
        # with `docs` so the export can split results onto separate sheets.
        self.labels: list[Optional[str]] = []
        self.current_label: Optional[str] = None

    def __enter__(self) -> 'CollectorWriter':
        return self

    def __exit__(self, *exc_info) -> None:
        pass

    def write(self, catalog_doc: Any) -> None:
        if self._require_license and not fracs_license.check().get('ok'):
            raise LicenseExpiredError('Подписка закончилась. Работа программы остановлена.')
        if not self._check_catalog_doc(catalog_doc):
            return
        self.docs.append(catalog_doc)
        self.labels.append(self.current_label)
        if self._options.verbose:
            record = extract_record(catalog_doc)
            logger.info('Парсинг [%d] > %s', len(self.docs),
                        record['name'] if record else '...')


class _ListLogHandler(logging.Handler):
    """Logging handler that appends formatted records to a shared list."""
    def __init__(self, sink: list[str]) -> None:
        super().__init__()
        self._sink = sink
        self.setFormatter(logging.Formatter('%(asctime)s | %(message)s', datefmt='%H:%M:%S'))

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self._sink.append(self.format(record))
            if len(self._sink) > _MAX_LOG_LINES:
                del self._sink[:len(self._sink) - _MAX_LOG_LINES]
        except Exception:
            pass


class ParseJob:
    """Background parsing job for the web dashboard (single job at a time)."""
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._parser = None
        self._cancelled = False
        self.status = 'idle'  # idle | running | done | stopped | error
        self.logs: list[str] = []
        self.error: Optional[str] = None
        self.collector: Optional[CollectorWriter] = None
        self._urls: list[str] = []

    @property
    def running(self) -> bool:
        return self.status == 'running'

    @property
    def count(self) -> int:
        return len(self.collector.docs) if self.collector else 0

    def start(self, config: Configuration, urls: list[str],
              labels: Optional[dict[str, str]] = None,
              require_license: bool = True,
              save_history: bool = True) -> None:
        with self._lock:
            if self.running:
                raise RuntimeError('Парсинг уже запущен')
            self.status = 'running'
            self.logs = []
            self.error = None
            self._cancelled = False
            self.collector = CollectorWriter(config.writer, require_license=require_license)

        self._urls = list(urls)
        self._thread = threading.Thread(target=self._run, args=(config, urls, labels or {}, require_license, save_history),
                                        daemon=True)
        self._thread.start()

    def start_yandex(self, config: Configuration, only_missing_website: bool = True,
                     remove_with_website: bool = True,
                     remove_not_found: bool = False,
                     docs: Optional[list[Any]] = None, labels: Optional[list[Any]] = None,
                     urls: Optional[list[str]] = None) -> None:
        """Second pass: look up contacts of collected records on Yandex Maps (no API).

        Works on the current results, or on `docs` (e.g. loaded from history).
        """
        with self._lock:
            if self.running:
                raise RuntimeError('Парсинг уже запущен')
            if docs is not None:
                collector = CollectorWriter(config.writer)
                collector.docs = list(docs)
                collector.labels = list(labels or [])
                collector.labels += [None] * (len(collector.docs) - len(collector.labels))
                self.collector = collector
                self._urls = list(urls or [])
            if not self.collector or not self.collector.docs:
                raise RuntimeError('Нет данных: сначала выполните парсинг 2GIS')
            self.status = 'running'
            self.logs = []
            self.error = None
            self._cancelled = False

        self._thread = threading.Thread(target=self._run_yandex,
                                        args=(config, only_missing_website, remove_with_website, remove_not_found), daemon=True)
        self._thread.start()

    def _run_yandex(self, config: Configuration, only_missing_website: bool,
                    remove_with_website: bool = True, remove_not_found: bool = False) -> None:
        handler = _ListLogHandler(self.logs)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        try:
            assert self.collector is not None
            enricher = YandexMaps(config.chrome)
            self._parser = enricher  # `stop()` closes it
            expired = False

            def _should_stop() -> bool:
                nonlocal expired
                if self._cancelled:
                    return True
                if not fracs_license.check().get('ok'):
                    expired = True
                    return True
                return False

            stats = enricher.enrich(self.collector.docs, only_missing_website,
                                    _should_stop, config.chrome.headless,
                                    add_site_to_record=not remove_with_website)
            if expired:
                self.error = 'Подписка закончилась. Работа программы остановлена.'
                self.status = 'error'
                logger.error('%s', self.error)
                return
            # Drop what should not stay in the final list (docs and district labels stay aligned):
            #  - businesses that DO have a website on Yandex Maps,
            #  - businesses Yandex says are permanently closed,
            #  - (optional) businesses with no Yandex card at all.
            drop: set[int] = set(stats['closed_idx'])
            if remove_with_website:
                drop |= set(stats['with_site'])
            if remove_not_found:
                drop |= set(stats['not_found_idx'])
            removed = len(drop)
            if drop:
                self.collector.docs = [d for i, d in enumerate(self.collector.docs) if i not in drop]
                self.collector.labels = [l for i, l in enumerate(self.collector.labels) if i not in drop]
            self.status = 'stopped' if self._cancelled else 'done'
            logger.info('Яндекс Карты %s: проверено %d из %d. Сайт найден у %d, закрыто по Яндексу: %d, '
                        'всего убрано из списка: %d. '
                        'Не найдено на Яндексе: %d, найдена другая организация: %d (остались в списке). '
                        'Итого в списке: %d.',
                        'остановлены' if self._cancelled else 'завершены',
                        stats['checked'], stats['total'], stats['found_site'], stats['closed'], removed,
                        stats['not_found'], stats['mismatch'], len(self.collector.docs))
        except YandexCaptcha as e:
            self.status = 'done'
            logger.error('%s', e)
        except Exception as e:
            if self._cancelled:
                self.status = 'stopped'
                logger.info('Яндекс Карты остановлены.')
            else:
                self.error = str(e)
                self.status = 'error'
                logger.error('Ошибка Яндекс Карт: %s: %s', type(e).__name__, e)
                logger.debug('Подробности ошибки', exc_info=True)
        finally:
            self._parser = None
            # Save the enriched results as a new history entry.
            if self.collector and self.collector.docs:
                try:
                    History().save((self._urls or []) + ['Яндекс Карты'], self.collector.docs,
                                   self.collector._options.model_dump(mode='json'),
                                   self.collector.labels)
                except Exception as e:
                    logger.error('Не удалось сохранить историю: %s', e)
            logger.removeHandler(handler)

    def start_owners(self, config: Configuration, only_missing: bool = True,
                     docs: Optional[list[Any]] = None, labels: Optional[list[Any]] = None,
                     urls: Optional[list[str]] = None) -> None:
        """Third pass: look up company owners (director / ИП) in open registries
        via Chrome. Works on the current results or on `docs` (from history).
        """
        with self._lock:
            if self.running:
                raise RuntimeError('Парсинг уже запущен')
            if docs is not None:
                collector = CollectorWriter(config.writer)
                collector.docs, collector.labels = list(docs), list(labels or [])
                collector.labels += [None] * (len(collector.docs) - len(collector.labels))
                self.collector, self._urls = collector, list(urls or [])
            if not self.collector or not self.collector.docs:
                raise RuntimeError('Нет данных: сначала выполните парсинг 2GIS')
            self.status, self.logs, self.error, self._cancelled = 'running', [], None, False
        self._thread = threading.Thread(target=self._run_owners, args=(config, only_missing), daemon=True)
        self._thread.start()

    def _run_owners(self, config: Configuration, only_missing: bool) -> None:
        handler = _ListLogHandler(self.logs)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        try:
            worker = Owners(config.chrome)
            self._parser = worker

            expired = False

            def stop() -> bool:
                nonlocal expired
                if self._cancelled:
                    return True
                if not fracs_license.check().get('ok'):
                    expired = True
                    return True
                return False

            st = worker.enrich(self.collector.docs, only_missing, stop, config.chrome.headless)
            if expired:
                self.error, self.status = 'Подписка закончилась. Работа программы остановлена.', 'error'
                return
            self.status = 'stopped' if self._cancelled else 'done'
            logger.info('Владельцы: проверено %d из %d, найдено %d (из них с ФИО: %d), не найдено %d.',
                        st['checked'], st['total'], st['found'], st.get('with_name', 0), st['not_found'])
        except OwnersCaptcha as e:
            self.status = 'done'
            logger.error('%s', e)
        except Exception as e:
            self.status = 'stopped' if self._cancelled else 'error'
            if not self._cancelled:
                self.error = str(e)
                logger.error('Ошибка поиска владельцев: %s: %s', type(e).__name__, e)
        finally:
            self._parser = None
            if self.collector and self.collector.docs:
                try:
                    History().save((self._urls or []) + ['Владельцы'], self.collector.docs,
                                   self.collector._options.model_dump(mode='json'),
                                   self.collector.labels)
                except Exception as e:
                    logger.error('Не удалось сохранить историю: %s', e)
            logger.removeHandler(handler)

    def stop(self) -> None:
        with self._lock:
            self._cancelled = True
            if self._parser:
                try:
                    self._parser.close()
                except Exception:
                    pass

    def clear(self) -> bool:
        """Drop the current results/logs (history is untouched). No-op while running."""
        with self._lock:
            if self.running:
                return False
            self.collector = None
            self.logs = []
            self.error = None
            self.status = 'idle'
            return True

    def _run(self, config: Configuration, urls: list[str],
             labels: Optional[dict[str, str]] = None,
             require_license: bool = True,
             save_history: bool = True) -> None:
        labels = labels or {}
        handler = _ListLogHandler(self.logs)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)  # ensure INFO progress lines are captured
        try:
            assert self.collector is not None
            writer: FileWriter = self.collector
            if any_filter_enabled(config.filters):
                writer = FilterWriter(self.collector, config.filters)

            logger.info('Парсинг запущен.')
            failed = 0
            with writer:
                for url in urls:
                    if self._cancelled:
                        break
                    if require_license and not fracs_license.check().get('ok'):
                        raise LicenseExpiredError('Подписка закончилась. Работа программы остановлена.')
                    # Tag documents from this URL with its district sheet label.
                    self.collector.current_label = labels.get(url)
                    logger.info('Парсинг ссылки %s', url)
                    try:
                        self._parser = get_parser(url, chrome_options=config.chrome,
                                                  parser_options=config.parser)
                        with self._parser:
                            if not self._cancelled:
                                self._parser.parse(writer)
                    except LicenseExpiredError:
                        raise
                    except Exception as e:
                        # A single URL failing (e.g. 2GIS anti-bot timeout) must not
                        # abort the whole run — log it, keep what it collected, and
                        # continue with the remaining URLs.
                        if self._cancelled:
                            break  # clean stop, not a failure
                        failed += 1
                        logger.error('Ссылка пропущена из-за ошибки: %s: %s', type(e).__name__, e or '(без описания)')
                        logger.debug('Подробности ошибки', exc_info=True)
                        continue

            self.status = 'stopped' if self._cancelled else 'done'
            if self._cancelled:
                logger.info('Парсинг остановлен.')
            elif failed:
                logger.warning('Готово частично: %d из %d ссылок не обработаны.', failed, len(urls))
                logger.info('Парсинг завершён.')
            else:
                logger.info('Парсинг завершён.')
        except LicenseExpiredError as e:
            self.error = str(e)
            self.status = 'error'
            logger.error('%s', self.error)
        except Exception as e:
            if self._cancelled:
                # Stopping closes the browser tab mid-request, surfacing as
                # "Tab has been stopped" — a clean stop, not a failure.
                self.status = 'stopped'
                logger.info('Парсинг остановлен.')
            else:
                self.error = str(e)
                self.status = 'error'
                logger.error('Ошибка во время работы парсера.', exc_info=True)
        finally:
            self._parser = None
            # Persist whatever was collected — full run, partial stop, or a crash
            # mid-run — so records survive reloads and aren't lost on Stop/error.
            if save_history and self.status in ('done', 'stopped', 'error') and self.collector and self.collector.docs:
                try:
                    History().save(urls, self.collector.docs,
                                   self.collector._options.model_dump(mode='json'),
                                   self.collector.labels)
                except Exception as e:
                    logger.error('Не удалось сохранить историю: %s', e)
            logger.removeHandler(handler)

    def results(self) -> list[dict]:
        """Presentation-ready records for the dashboard grid."""
        if not self.collector:
            return []
        out = []
        for doc in self.collector.docs:
            record = extract_record(doc)
            if record:
                out.append(record)
        return out

    def export(self, output_path: str, file_format: str) -> None:
        """Write collected documents to `output_path` in the given format."""
        if not self.collector:
            raise RuntimeError('Нет данных для экспорта')
        # Filters were already applied while collecting; export raw collected docs.
        with get_writer(output_path, file_format, self.collector._options) as writer:
            for doc in self.collector.docs:
                writer.write(doc)
