import pyodbc
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from app.config import Config
from app.logging_config import get_scheduler_logger

logger = get_scheduler_logger()
_scheduler = None

# Day mapping: frontend label → APScheduler cron value
DAY_MAP = {'Mon': 'mon', 'Tue': 'tue', 'Wed': 'wed', 'Thu': 'thu', 'Fri': 'fri', 'Sat': 'sat', 'Sun': 'sun'}


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


# ------------------------------------------------------------------
# Table setup
# ------------------------------------------------------------------

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


def ensure_config_table():
    """Create Scheduler_Config table if it doesn't exist and seed a default row."""
    try:
        conn = _get_db_connection()
        with conn:
            cursor = conn.cursor()
            cursor.execute("""
                IF NOT EXISTS (
                    SELECT * FROM INFORMATION_SCHEMA.TABLES
                    WHERE TABLE_NAME = 'Scheduler_Config'
                )
                BEGIN
                    CREATE TABLE [dbo].[Scheduler_Config] (
                        Id INT IDENTITY(1,1) PRIMARY KEY,
                        IntervalMinutes INT NOT NULL DEFAULT 60,
                        StartHour INT NOT NULL DEFAULT 8,
                        EndHour INT NOT NULL DEFAULT 0,
                        ActiveDays VARCHAR(50) NOT NULL DEFAULT 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
                        UpdatedAt DATETIME NULL,
                        UpdatedBy VARCHAR(50) NULL
                    );
                    INSERT INTO [dbo].[Scheduler_Config]
                        (IntervalMinutes, StartHour, EndHour, ActiveDays)
                    VALUES (60, 8, 0, 'Mon,Tue,Wed,Thu,Fri,Sat,Sun');
                END
            """)
            conn.commit()
        logger.info("[Scheduler] Config table verified")
    except Exception as e:
        logger.error(f"[Scheduler] Failed to ensure config table: {e}")


# ------------------------------------------------------------------
# Config CRUD
# ------------------------------------------------------------------

def get_scheduler_config():
    """Read schedule configuration from the database."""
    try:
        conn = _get_db_connection()
        with conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT IntervalMinutes, StartHour, EndHour, ActiveDays, UpdatedAt, UpdatedBy "
                "FROM [dbo].[Scheduler_Config] WHERE Id = 1"
            )
            row = cursor.fetchone()
            if row:
                return {
                    'intervalMinutes': row[0],
                    'startHour': row[1],
                    'endHour': row[2],
                    'activeDays': row[3].split(',') if row[3] else [],
                    'updatedAt': row[4].isoformat() if row[4] else None,
                    'updatedBy': row[5],
                }
    except Exception as e:
        logger.error(f"[Scheduler] Config read error: {e}")

    # Fallback to env-var defaults
    config = Config()
    return {
        'intervalMinutes': config.SCHEDULER_INTERVAL_MINUTES,
        'startHour': config.SCHEDULER_START_HOUR,
        'endHour': config.SCHEDULER_END_HOUR,
        'activeDays': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        'updatedAt': None,
        'updatedBy': None,
    }


def update_scheduler_config(interval_minutes, start_hour, end_hour, active_days, updated_by=None):
    """Persist new config to DB and reschedule APScheduler jobs."""
    days_str = ','.join(active_days)
    try:
        conn = _get_db_connection()
        with conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE [dbo].[Scheduler_Config] "
                "SET IntervalMinutes = ?, StartHour = ?, EndHour = ?, ActiveDays = ?, "
                "UpdatedAt = GETDATE(), UpdatedBy = ? "
                "WHERE Id = 1",
                (interval_minutes, start_hour, end_hour, days_str, updated_by)
            )
            conn.commit()
        logger.info(f"[Scheduler] Config updated: every {interval_minutes}min, hours {start_hour}-{end_hour}, days {days_str}")
    except Exception as e:
        logger.error(f"[Scheduler] Config update error: {e}")
        raise

    # Reschedule with new config
    reschedule_jobs(interval_minutes, start_hour, end_hour, active_days)


# ------------------------------------------------------------------
# Cron helpers
# ------------------------------------------------------------------

def _build_cron_hours(start_h, end_h):
    """Build APScheduler cron hour string, e.g. '0,8-23'."""
    if end_h < start_h:
        return f"{end_h},{start_h}-23"
    return f"{start_h}-{end_h}"


def _build_cron_days(active_days):
    """Convert ['Mon','Tue',...] to APScheduler cron day_of_week string."""
    cron_days = [DAY_MAP[d] for d in active_days if d in DAY_MAP]
    return ','.join(cron_days) if cron_days else 'mon-sun'


def _build_trigger(cron_hours, cron_days, minute, interval_minutes):
    """Build a CronTrigger. For intervals > 60 min, use step syntax on hours."""
    if interval_minutes >= 60:
        step = interval_minutes // 60
        return CronTrigger(hour=f"{cron_hours}/{step}" if step > 1 else cron_hours,
                           minute=minute, day_of_week=cron_days)
    return CronTrigger(hour=cron_hours, minute=f"*/{interval_minutes}",
                       day_of_week=cron_days)


# ------------------------------------------------------------------
# Dynamic reschedule
# ------------------------------------------------------------------

def reschedule_jobs(interval_minutes, start_hour, end_hour, active_days):
    """Remove and re-add scheduler jobs with new cron config."""
    global _scheduler
    if not _scheduler or not _scheduler.running:
        logger.warning("[Scheduler] Cannot reschedule — scheduler not running")
        return

    cron_hours = _build_cron_hours(start_hour, end_hour)
    cron_days = _build_cron_days(active_days)

    # Remove existing jobs
    for job_id in ('d_drive_scan', 'ib_storage_scan'):
        try:
            _scheduler.remove_job(job_id)
        except Exception:
            pass

    _scheduler.add_job(
        run_d_drive_scan,
        trigger=_build_trigger(cron_hours, cron_days, 0, interval_minutes),
        id='d_drive_scan',
        name='D Drive Auto-Scan',
        misfire_grace_time=300, coalesce=True, max_instances=1,
    )

    _scheduler.add_job(
        run_ib_storage_scan,
        trigger=_build_trigger(cron_hours, cron_days, 5, interval_minutes),
        id='ib_storage_scan',
        name='IBSTORAGE Auto-Scan',
        misfire_grace_time=300, coalesce=True, max_instances=1,
    )

    logger.info(f"[Scheduler] Rescheduled — hours={cron_hours}, days={cron_days}, interval={interval_minutes}min")


# ------------------------------------------------------------------
# Lock management
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# Scan jobs
# ------------------------------------------------------------------

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


# ------------------------------------------------------------------
# Status API
# ------------------------------------------------------------------

def get_scheduler_status():
    """Return current scheduler status for both scan types + config."""
    global _scheduler

    cfg = get_scheduler_config()
    result = {
        'd_drive': None,
        'ib_storage': None,
        'schedulerEnabled': Config.SCHEDULER_ENABLED,
        'intervalMinutes': cfg['intervalMinutes'],
        'activeHours': f"{cfg['startHour']}:00 - {cfg['endHour']}:00",
        'activeDays': cfg['activeDays'],
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


# ------------------------------------------------------------------
# Initialization
# ------------------------------------------------------------------

def init_scheduler(app):
    """Initialize and start the background scheduler."""
    global _scheduler
    config = Config()

    if not config.SCHEDULER_ENABLED:
        logger.info("[Scheduler] Disabled via SCHEDULER_ENABLED=false")
        return

    ensure_status_table()
    ensure_config_table()

    # Load config from DB
    cfg = get_scheduler_config()
    interval = cfg['intervalMinutes']
    start_h = cfg['startHour']
    end_h = cfg['endHour']
    active_days = cfg['activeDays']

    cron_hours = _build_cron_hours(start_h, end_h)
    cron_days = _build_cron_days(active_days)

    _scheduler = BackgroundScheduler(daemon=True)

    _scheduler.add_job(
        run_d_drive_scan,
        trigger=_build_trigger(cron_hours, cron_days, 0, interval),
        id='d_drive_scan',
        name='D Drive Auto-Scan',
        misfire_grace_time=300, coalesce=True, max_instances=1,
    )

    _scheduler.add_job(
        run_ib_storage_scan,
        trigger=_build_trigger(cron_hours, cron_days, 5, interval),
        id='ib_storage_scan',
        name='IBSTORAGE Auto-Scan',
        misfire_grace_time=300, coalesce=True, max_instances=1,
    )

    _scheduler.start()
    logger.info(f"[Scheduler] Started — hours={cron_hours}, days={cron_days}, interval={interval}min")
