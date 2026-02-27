import os

class Config:
    DB_SERVER = os.getenv('DB_SERVER')
    DB_DATABASE = os.getenv('DB_DATABASE')
    DB_USERNAME = os.getenv('DB_USERNAME')
    DB_PASSWORD = os.getenv('DB_PASSWORD')
    SHARE_NAME = os.getenv('SHARE', 'd$')
    FOLDER_PATH = os.getenv('FOLDER', 'BackupFull')
    SHARE_USERNAME = os.getenv('SMB_USER')
    SHARE_PASSWORD = os.getenv('SMB_PASS')
    PING_COMMAND = 'ping -n 3' if os.name == 'nt' else 'ping -c 3'
    MAX_WORKERS = min(10, os.cpu_count() * 2)
    TIMEOUT = 30
    MAX_RETRIES = 3

    # IBSTORAGE: USB portable drive with variable drive letter
    IB_STORAGE_DRIVES = os.getenv('IB_STORAGE_DRIVES', 'e$,f$,g$,h$,i$').split(',')
    IB_STORAGE_FOLDER = os.getenv('IB_STORAGE_FOLDER', 'BackupFull')

    # JWT Authentication
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'fallback-dev-secret-change-me')
    JWT_EXPIRATION_HOURS = int(os.getenv('JWT_EXPIRATION_HOURS', '8'))

    # Background Scheduler
    SCHEDULER_ENABLED = os.getenv('SCHEDULER_ENABLED', 'true').lower() == 'true'
    SCHEDULER_INTERVAL_MINUTES = int(os.getenv('SCHEDULER_INTERVAL_MINUTES', '60'))

    # Central Server (EPSMirror) — read-only sync source
    CENTRAL_DB_SERVER = os.getenv('CENTRAL_DB_SERVER')
    CENTRAL_DB_DATABASE = os.getenv('CENTRAL_DB_DATABASE')
    CENTRAL_DB_USERNAME = os.getenv('CENTRAL_DB_USERNAME')
    CENTRAL_DB_PASSWORD = os.getenv('CENTRAL_DB_PASSWORD')