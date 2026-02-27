import pyodbc
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from apscheduler.schedulers.background import BackgroundScheduler
from app.config import Config
from app.logging_config import get_scheduler_logger

logger = get_scheduler_logger()
_scheduler = None


def _get_db_connection():
    config = Config()
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={config.DB_SERVER};"
        f"DATABASE={config.DB_DATABASE};"
        f"UID={config.DB_USERNAME};"
        f"PWD={config.DB_PASSWORD};"
        "Encrypt=no;TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str)


def ensure_status_table():
    """Create Scheduler_Status table if it doesn't exist and seed initial rows."""
    try:
        conn = _get_db_connection()
        with conn:
            cursor = conn.cursor()
            cursor.execute("""
                IF NOT EXISTS (
                    SELECT * FROM INFORMATION_SCHEMA.TABLES
                    WHERE TABLE_NAME = 'Scheduler_Status'
                )
                BEGIN
                    CREATE TABLE [dbo].[Scheduler_Status] (
                        Id INT IDENTITY(1,1) PRIMARY KEY,
                        ScanType VARCHAR(20) NOT NULL,
                        Status VARCHAR(20) NOT NULL DEFAULT 'Idle',
                        LastScanStart DATETIME NULL,
                        LastScanEnd DATETIME NULL,
                        TotalOutlets INT NULL,
                        Successful INT NULL,
                        Failed INT NULL,
                        ErrorMessage VARCHAR(500) NULL
                    );
                    INSERT INTO [dbo].[Scheduler_Status] (ScanType, Status) VALUES ('D_Drive', 'Idle');
                    INSERT INTO [dbo].[Scheduler_Status] (ScanType, Status) VALUES ('IB_Storage', 'Idle');
                END
            """)
            conn.commit()
        logger.info("[Scheduler] Status table verified")
    except Exception as e:
        logger.error(f"[Scheduler] Failed to ensure status table: {e}")


def _acquire_lock(scan_type):
    """Try to acquire the run lock for a scan type. Returns True if acquired."""
    try:
        conn = _get_db_connection()
        with conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE [dbo].[Scheduler_Status] "
                "SET Status = 'Running', LastScanStart = GETDATE() "
                "WHERE ScanType = ? AND Status != 'Running'",
                (scan_type,)
            )
            conn.commit()
            return cursor.rowcount == 1
    except Exception as e:
        logger.error(f"[Scheduler] Lock acquire failed for {scan_type}: {e}")
        return False


def _release_lock(scan_type, total, success, failed, error_msg=None):
    """Release the run lock and save scan results."""
    status = 'Failed' if error_msg else 'Completed'
    try:
        conn = _get_db_connection()
        with conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE [dbo].[Scheduler_Status] "
                "SET Status = ?, LastScanEnd = GETDATE(), "
                "TotalOutlets = ?, Successful = ?, Failed = ?, ErrorMessage = ? "
                "WHERE ScanType = ?",
                (status, total, success, failed, error_msg, scan_type)
            )
            conn.commit()
    except Exception as e:
        logger.error(f"[Scheduler] Lock release failed for {scan_type}: {e}")


def run_d_drive_scan():
    """Background job: scan all outlets for D Drive backups."""
    scan_type = 'D_Drive'

    if not _acquire_lock(scan_type):
        logger.info(f"[Scheduler] {scan_type} scan already running, skipping")
        return

    logger.info(f"[Scheduler] Starting {scan_type} auto-scan")
    total = success = failed = 0
    try:
        from app.services.backup_service import BackupMonitor
        monitor = BackupMonitor()
        outlets = monitor.get_outlets()
        if not outlets:
            logger.warning(f"[Scheduler] No active outlets found for {scan_type}")
            _release_lock(scan_type, 0, 0, 0)
            return

        total = len(outlets)
        results = []
        with ThreadPoolExecutor(max_workers=monitor.config.MAX_WORKERS) as executor:
            results = list(executor.map(monitor.check_server, outlets))

        success = sum(1 for r in results if r['status'] == 'Successful')
        failed = total - success

        monitor.save_backup_status(results)
        logger.info(f"[Scheduler] {scan_type} auto-scan complete: {success}/{total} successful")
        _release_lock(scan_type, total, success, failed)

    except Exception as e:
        logger.error(f"[Scheduler] {scan_type} auto-scan error: {e}")
        logger.error(traceback.format_exc())
        _release_lock(scan_type, total, success, failed, str(e)[:500])


def run_ib_storage_scan():
    """Background job: scan all outlets for IBSTORAGE backups."""
    scan_type = 'IB_Storage'

    if not _acquire_lock(scan_type):
        logger.info(f"[Scheduler] {scan_type} scan already running, skipping")
        return

    logger.info(f"[Scheduler] Starting {scan_type} auto-scan")
    total = success = failed = 0
    try:
        from app.services.Ib_Storage_backup_service import IBStorageMonitor
        monitor = IBStorageMonitor()
        outlets = monitor.get_outlets()
        if not outlets:
            logger.warning(f"[Scheduler] No active outlets found for {scan_type}")
            _release_lock(scan_type, 0, 0, 0)
            return

        total = len(outlets)
        results = []
        with ThreadPoolExecutor(max_workers=monitor.config.MAX_WORKERS) as executor:
            results = list(executor.map(monitor.check_server, outlets))

        success = sum(1 for r in results if r['status'] == 'Successful')
        failed = total - success

        monitor.save_backup_status(results)
        logger.info(f"[Scheduler] {scan_type} auto-scan complete: {success}/{total} successful")
        _release_lock(scan_type, total, success, failed)

    except Exception as e:
        logger.error(f"[Scheduler] {scan_type} auto-scan error: {e}")
        logger.error(traceback.format_exc())
        _release_lock(scan_type, total, success, failed, str(e)[:500])


def get_scheduler_status():
    """Return current scheduler status for both scan types."""
    global _scheduler
    result = {
        'd_drive': None,
        'ib_storage': None,
        'schedulerEnabled': Config.SCHEDULER_ENABLED,
        'intervalMinutes': Config.SCHEDULER_INTERVAL_MINUTES,
        'nextDDriveRun': None,
        'nextIBStorageRun': None,
    }

    try:
        conn = _get_db_connection()
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT ScanType, Status, LastScanStart, LastScanEnd, TotalOutlets, Successful, Failed, ErrorMessage FROM [dbo].[Scheduler_Status]")
            for row in cursor.fetchall():
                entry = {
                    'status': row[1],
                    'lastScanStart': row[2].isoformat() if row[2] else None,
                    'lastScanEnd': row[3].isoformat() if row[3] else None,
                    'total': row[4],
                    'successful': row[5],
                    'failed': row[6],
                    'errorMessage': row[7],
                }
                if row[0] == 'D_Drive':
                    result['d_drive'] = entry
                elif row[0] == 'IB_Storage':
                    result['ib_storage'] = entry
    except Exception as e:
        logger.error(f"[Scheduler] Status read error: {e}")

    # Next run times from APScheduler
    if _scheduler and _scheduler.running:
        for job in _scheduler.get_jobs():
            next_run = job.next_run_time
            if next_run:
                next_run_str = next_run.isoformat()
                if job.id == 'd_drive_scan':
                    result['nextDDriveRun'] = next_run_str
                elif job.id == 'ib_storage_scan':
                    result['nextIBStorageRun'] = next_run_str

    return result


def init_scheduler(app):
    """Initialize and start the background scheduler."""
    global _scheduler
    config = Config()

    if not config.SCHEDULER_ENABLED:
        logger.info("[Scheduler] Disabled via SCHEDULER_ENABLED=false")
        return

    ensure_status_table()

    _scheduler = BackgroundScheduler(daemon=True)

    interval = config.SCHEDULER_INTERVAL_MINUTES

    _scheduler.add_job(
        run_d_drive_scan,
        trigger='interval',
        minutes=interval,
        id='d_drive_scan',
        name='D Drive Auto-Scan',
        misfire_grace_time=300,
        coalesce=True,
        max_instances=1,
    )

    _scheduler.add_job(
        run_ib_storage_scan,
        trigger='interval',
        minutes=interval,
        id='ib_storage_scan',
        name='IBSTORAGE Auto-Scan',
        misfire_grace_time=300,
        coalesce=True,
        max_instances=1,
    )

    _scheduler.start()
    logger.info(f"[Scheduler] Started with {interval}-minute interval for both D Drive and IBSTORAGE")
