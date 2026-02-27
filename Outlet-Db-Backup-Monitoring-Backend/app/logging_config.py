import os
import logging
from datetime import date


LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'logs')


class DailyFileHandler(logging.FileHandler):
    """File handler that automatically rolls to a new date-stamped file at midnight.

    Creates files like:
        logs/D_Drive_Backup_log_2026-02-21.log
        logs/IB_Storage_Backup_log_2026-02-21.log
    """

    def __init__(self, log_dir, prefix):
        self.log_dir = log_dir
        self.prefix = prefix
        self._current_date = None
        os.makedirs(log_dir, exist_ok=True)
        filename = self._get_filename()
        super().__init__(filename, encoding='utf-8')

    def _get_filename(self):
        today = date.today().isoformat()
        self._current_date = today
        return os.path.join(self.log_dir, f"{self.prefix}_{today}.log")

    def emit(self, record):
        today = date.today().isoformat()
        if today != self._current_date:
            self.close()
            self.baseFilename = self._get_filename()
            self.stream = self._open()
        super().emit(record)


_LOG_FORMAT = '%(asctime)s - %(levelname)s - %(message)s'


def _setup_logger(name, prefix):
    """Create and configure a named logger with daily file + console output."""
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    formatter = logging.Formatter(_LOG_FORMAT)

    # Daily file handler
    file_handler = DailyFileHandler(LOG_DIR, prefix)
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    # Console handler (for docker logs / stdout)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    return logger


def get_d_drive_logger():
    return _setup_logger('d_drive', 'D_Drive_Backup_log')


def get_ib_storage_logger():
    return _setup_logger('ib_storage', 'IB_Storage_Backup_log')


def get_scheduler_logger():
    return _setup_logger('scheduler', 'Scheduler_log')
