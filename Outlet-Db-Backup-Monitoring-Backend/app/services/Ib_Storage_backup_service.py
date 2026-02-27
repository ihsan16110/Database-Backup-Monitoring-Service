import os
import time
import pyodbc
import traceback
from smbprotocol.exceptions import SMBConnectionClosed, SMBException
from datetime import datetime, date, timezone
from smbclient import register_session, delete_session, listdir, scandir
from app.config import Config
from app.logging_config import get_ib_storage_logger


class IBStorageMonitor:
    """Monitor IBSTORAGE (USB portable drive) backups across outlet servers.

    The IBSTORAGE drive letter varies per server (could be E:, F:, G:, H:, I:),
    so we try each candidate drive letter until we find one with a BackupFull folder.
    """

    def __init__(self):
        self.config = Config()
        self.logger = get_ib_storage_logger()
        self.scan_date = None  # None = today; date object = back-date scan

    def log_error(self, message, severity="ERROR"):
        if severity == "CRITICAL":
            self.logger.critical(message)
        else:
            self.logger.error(message)

    def get_db_connection(self):
        conn_str = (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={self.config.DB_SERVER};"
            f"DATABASE={self.config.DB_DATABASE};"
            f"UID={self.config.DB_USERNAME};"
            f"PWD={self.config.DB_PASSWORD};"
            "Encrypt=no;TrustServerCertificate=yes;"
        )
        try:
            return pyodbc.connect(conn_str)
        except pyodbc.Error as e:
            self.logger.error(f"Database connection error: {e}")
            return None

    # ------------------------------------------------------------------
    # Server scanning
    # ------------------------------------------------------------------

    def ping_with_retry(self, server_ip):
        import socket
        for _ in range(self.config.MAX_RETRIES):
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(5)
                result = sock.connect_ex((server_ip, 445))
                sock.close()
                if result == 0:
                    return True
            except Exception as e:
                self.logger.error(f"TCP check failed for {server_ip}: {str(e)}")
            time.sleep(1)
        return False

    def find_ibstorage_path(self, server_name):
        """Try each candidate drive letter to find the IBSTORAGE BackupFull folder.

        Returns (smb_path, drive_letter) if found, or (None, None) if not found.
        """
        folder = self.config.IB_STORAGE_FOLDER
        for drive in self.config.IB_STORAGE_DRIVES:
            drive = drive.strip()
            smb_path = f"\\\\{server_name}\\{drive}\\{folder}"
            try:
                listdir(smb_path)
                self.logger.info(f"[IB] Found IBSTORAGE at {smb_path}")
                return smb_path, drive
            except Exception:
                continue
        return None, None

    def check_server(self, outlet):
        """Check IBSTORAGE backup status for a single outlet server."""
        outlet_code, server_ip = outlet
        result = {
            'outletCode': outlet_code,
            'server': server_ip,
            'lastModified': None,
            'status': 'Error',
            'errorDetails': None,
            'backupsize': None,
            'driveLetter': None
        }

        self.logger.info(f"[IB] Checking server: {server_ip} (Outlet: {outlet_code})")
        if not self.ping_with_retry(server_ip):
            self.logger.error(f"[IB] Ping failed for {server_ip}")
            result['errorDetails'] = 'Server not Reachable'
            return result

        try:
            register_session(
                server_ip,
                username=self.config.SHARE_USERNAME,
                password=self.config.SHARE_PASSWORD
            )

            # Try candidate drive letters to find IBSTORAGE
            smb_path, drive_letter = self.find_ibstorage_path(server_ip)
            if not smb_path:
                self.logger.warning(f"[IB] IBSTORAGE drive not found on {server_ip}")
                result['errorDetails'] = 'IBSTORAGE drive not found (checked e$-i$)'
                return result

            result['driveLetter'] = drive_letter

            # Get latest backup with validation
            latest_file, mod_time, backup_size = self.get_validated_backup(smb_path, cutoff_date=self.scan_date)
            if latest_file:
                self.logger.info(f"[IB] Found valid backup: {latest_file} ({backup_size} GB)")
                result['lastModified'] = mod_time.isoformat()
                result['status'] = 'Successful'
                result['file'] = os.path.basename(latest_file)
                result['backupsize'] = f"{backup_size} GB"
            else:
                self.logger.warning(f"[IB] No valid backup files found in {smb_path}")
                result['errorDetails'] = 'No Valid Backup Files Found'

        except (SMBConnectionClosed, SMBException) as smb_e:
            self.logger.error(f"[IB] SMB Protocol Error for {server_ip}: {str(smb_e)}")
            result['errorDetails'] = f"SMB Protocol Error: {str(smb_e)}"
        except Exception as e:
            self.logger.error(f"[IB] Unexpected Error for {server_ip}: {str(e)}")
            result['errorDetails'] = f"Error: {str(e)}"
        finally:
            try:
                delete_session(server_ip)
            except Exception:
                pass

        return result

    def get_validated_backup(self, smb_path, cutoff_date=None):
        """Find the latest valid .bak file and its size.

        Uses scandir() with follow_symlinks=False so file metadata is read
        from the cached directory listing rather than opening each file.
        This avoids STATUS_INVALID_PARAMETER errors on USB/IBSTORAGE drives.

        When cutoff_date (a date object) is provided, only files modified on or
        before that date are considered. This enables back-date scanning.
        """
        try:
            latest_file = None
            latest_time = None
            latest_size = 0
            min_size = 1024

            # For back-date scans, compute end-of-day cutoff in UTC
            cutoff_dt = None
            if cutoff_date:
                cutoff_dt = datetime.combine(cutoff_date, datetime.max.time()).replace(tzinfo=timezone.utc)

            for entry in scandir(smb_path):
                if not entry.name.lower().endswith('.bak'):
                    continue

                try:
                    # follow_symlinks=False uses cached dir listing metadata
                    # instead of opening each file individually
                    file_info = entry.stat(follow_symlinks=False)
                    file_size = file_info.st_size
                    mod_time = datetime.fromtimestamp(file_info.st_mtime, tz=timezone.utc)
                except Exception:
                    # Fallback: use smb_info (SMBDirEntryInformation named tuple)
                    # from the directory listing when stat() fails with
                    # STATUS_INVALID_PARAMETER on USB/IBSTORAGE drives
                    try:
                        info = entry.smb_info
                        file_size = info.end_of_file
                        mod_time = info.last_write_time
                        if mod_time.tzinfo is None:
                            mod_time = mod_time.replace(tzinfo=timezone.utc)
                    except Exception as e2:
                        self.logger.warning(f"[IB] Cannot get info for {entry.name}: {e2}")
                        continue

                if file_size < min_size:
                    continue

                # Skip files newer than the cutoff for back-date scans
                if cutoff_dt and mod_time > cutoff_dt:
                    continue

                if not latest_time or mod_time > latest_time:
                    latest_file = entry.name
                    latest_time = mod_time
                    latest_size = file_size

            if latest_file:
                file_size_gb = round(latest_size / (1024 * 1024 * 1024), 2)
                return (latest_file, latest_time, file_size_gb)
            else:
                return None, None, None

        except (SMBConnectionClosed, SMBException) as smb_e:
            self.logger.error(f"[IB] SMB Protocol Error during backup search: {str(smb_e)}")
            raise
        except Exception as e:
            self.logger.error(f"[IB] Backup Search Error: {str(e)}")
            return None, None, None

    # ------------------------------------------------------------------
    # Database operations
    # ------------------------------------------------------------------

    def save_backup_status(self, results):
        """Save IBSTORAGE check results to IB_Storage_Backup_Stat.

        Skips UPDATE if key fields (Status, BackupFile, BackupFileSize, ErrorDetails,
        DriveLetter) are unchanged from the existing record.
        """
        self.logger.info(f"[IB] Saving {len(results)} results")
        today = self.scan_date if self.scan_date else date.today()

        try:
            conn = self.get_db_connection()
            if not conn:
                return

            updated = inserted = skipped = 0
            with conn:
                cursor = conn.cursor()
                for res in results:
                    outlet_code = res['outletCode']
                    status = res['status']
                    last_backup = res.get('lastModified')
                    backup_file = res.get('file', 'N/A')
                    storage_used = res.get('backupsize', 'N/A')
                    error_details = res.get('errorDetails')
                    drive_letter = res.get('driveLetter')

                    # Convert ISO string to naive datetime for SQL Server compatibility
                    last_backup_dt = None
                    if last_backup:
                        try:
                            last_backup_dt = datetime.fromisoformat(last_backup).replace(tzinfo=None)
                        except (ValueError, TypeError):
                            self.logger.warning(f"[IB] Could not parse lastModified '{last_backup}' for {outlet_code}")

                    try:
                        # Fetch existing record for comparison
                        cursor.execute(
                            "SELECT Status, BackupFile, BackupFileSize, ErrorDetails, DriveLetter FROM [dbo].[IB_Storage_Backup_Stat] WHERE OutletServer = ? AND ScanDate = ?",
                            (outlet_code, today)
                        )
                        existing = cursor.fetchone()

                        if existing:
                            # Skip update if key fields are unchanged
                            if (existing[0] == status and
                                    (existing[1] or '') == (backup_file or '') and
                                    (existing[2] or '') == (storage_used or '') and
                                    (existing[3] or '') == (error_details or '') and
                                    (existing[4] or '') == (drive_letter or '')):
                                skipped += 1
                                continue

                            cursor.execute("""
                                UPDATE [dbo].[IB_Storage_Backup_Stat]
                                SET Status = ?, LastBackupTaken = ?, BackupFile = ?, Duration = ?,
                                    BackupFileSize = ?, ErrorDetails = ?, DriveLetter = ?
                                WHERE OutletServer = ? AND ScanDate = ?
                            """, (status, last_backup_dt, backup_file, None, storage_used,
                                  error_details, drive_letter, outlet_code, today))
                            updated += 1
                        else:
                            cursor.execute("""
                                INSERT INTO [dbo].[IB_Storage_Backup_Stat]
                                (OutletServer, Status, LastBackupTaken, BackupFile, Duration,
                                 BackupFileSize, ScanDate, ErrorDetails, DriveLetter)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (outlet_code, status, last_backup_dt, backup_file, None,
                                  storage_used, today, error_details, drive_letter))
                            inserted += 1
                    except Exception as sql_e:
                        self.logger.error(f"[IB] SQL Error for outlet {outlet_code}: {str(sql_e)}")

                conn.commit()
                self.logger.info(f"[IB] IB_Storage_Backup_Stat ScanDate={today}: {inserted} inserted, {updated} updated, {skipped} unchanged")
        except Exception as e:
            self.logger.error(f"[IB] Database Persistence Error: {str(e)}")
            self.logger.error(traceback.format_exc())

    def _parse_row(self, row):
        return {
            'outletCode': row[0],
            'server': row[1] or '',
            'status': row[2],
            'lastModified': row[3].isoformat() if isinstance(row[3], datetime) else row[3],
            'file': row[4],
            'backupsize': row[5],
            'scanDate': row[6].isoformat() if isinstance(row[6], date) else row[6],
            'errorDetails': row[7],
            'driveLetter': row[8]
        }

    def _is_advanced_date(self, last_modified):
        if not last_modified:
            return False
        try:
            if isinstance(last_modified, str):
                last_modified = datetime.fromisoformat(last_modified)
            return last_modified.year > date.today().year
        except (ValueError, AttributeError):
            return False

    def _categorize_results(self, rows):
        normal = []
        advanced_date = []
        for row in rows:
            record = self._parse_row(row)
            if self._is_advanced_date(row[3]):
                advanced_date.append(record)
            else:
                normal.append(record)
        return normal, advanced_date

    def get_all_backup_stats(self):
        """Fetch latest scan date's IBSTORAGE stats."""
        try:
            conn = self.get_db_connection()
            if not conn:
                return {'normal': [], 'advancedDate': []}
            with conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT b.OutletServer, o.IPAddress, b.Status, b.LastBackupTaken,
                           b.BackupFile, b.BackupFileSize, b.ScanDate, b.ErrorDetails,
                           b.DriveLetter
                    FROM [dbo].[IB_Storage_Backup_Stat] b
                    LEFT JOIN [dbo].[Outlets] o ON b.OutletServer = o.OutletCode
                    WHERE b.ScanDate = (SELECT MAX(ScanDate) FROM [dbo].[IB_Storage_Backup_Stat])
                    ORDER BY b.OutletServer
                """)
                rows = cursor.fetchall()
                normal, advanced_date = self._categorize_results(rows)
                return {'normal': normal, 'advancedDate': advanced_date}
        except Exception as e:
            self.logger.error(f"[IB] Database Read Error: {str(e)}")
            self.logger.error(traceback.format_exc())
            return {'normal': [], 'advancedDate': []}

    def get_filtered_backup_stats(self, outlet=None, date_from=None, date_to=None):
        try:
            conn = self.get_db_connection()
            if not conn:
                return {'normal': [], 'advancedDate': []}
            with conn:
                cursor = conn.cursor()
                query = """
                    SELECT b.OutletServer, o.IPAddress, b.Status, b.LastBackupTaken,
                           b.BackupFile, b.BackupFileSize, b.ScanDate, b.ErrorDetails,
                           b.DriveLetter
                    FROM [dbo].[IB_Storage_Backup_Stat] b
                    LEFT JOIN [dbo].[Outlets] o ON b.OutletServer = o.OutletCode
                    WHERE 1=1
                """
                params = []
                if outlet:
                    query += " AND b.OutletServer = ?"
                    params.append(outlet)
                if date_from:
                    query += " AND b.ScanDate >= ?"
                    params.append(date_from)
                if date_to:
                    query += " AND b.ScanDate <= ?"
                    params.append(date_to)
                query += " ORDER BY b.ScanDate DESC, b.OutletServer"

                cursor.execute(query, params)
                rows = cursor.fetchall()
                normal, advanced_date = self._categorize_results(rows)
                return {'normal': normal, 'advancedDate': advanced_date}
        except Exception as e:
            self.logger.error(f"[IB] Filtered stats error: {str(e)}")
            self.logger.error(traceback.format_exc())
            return {'normal': [], 'advancedDate': []}

    def get_daily_summary(self, limit=30):
        try:
            conn = self.get_db_connection()
            if not conn:
                return []
            with conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT
                        ScanDate,
                        COUNT(*) AS Total,
                        SUM(CASE WHEN Status = 'Successful' THEN 1 ELSE 0 END) AS Successful,
                        SUM(CASE WHEN Status != 'Successful' THEN 1 ELSE 0 END) AS Failed
                    FROM [dbo].[IB_Storage_Backup_Stat]
                    GROUP BY ScanDate
                    ORDER BY ScanDate DESC
                    OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY
                """, (limit,))
                rows = cursor.fetchall()
                return [
                    {
                        'scanDate': row[0].isoformat() if isinstance(row[0], date) else row[0],
                        'total': row[1],
                        'successful': row[2],
                        'failed': row[3]
                    }
                    for row in rows
                ]
        except Exception as e:
            self.logger.error(f"[IB] Daily summary error: {str(e)}")
            self.logger.error(traceback.format_exc())
            return []

    def get_outlets(self):
        try:
            conn = self.get_db_connection()
            if not conn:
                return []
            with conn:
                cursor = conn.cursor()
                cursor.execute("SELECT OutletCode, IPAddress FROM Outlets WHERE ActiveDepot = 'Y'")
                return cursor.fetchall()
        except pyodbc.Error as e:
            self.logger.error(f"[IB] Database Error: {str(e)}")
            return []

    def get_outlets_by_codes(self, codes):
        try:
            conn = self.get_db_connection()
            if not conn:
                return []
            with conn:
                cursor = conn.cursor()
                placeholders = ','.join('?' for _ in codes)
                cursor.execute(
                    f"SELECT OutletCode, IPAddress FROM Outlets WHERE OutletCode IN ({placeholders})",
                    codes
                )
                return cursor.fetchall()
        except pyodbc.Error as e:
            self.logger.error(f"[IB] Database Error fetching outlets by codes: {str(e)}")
            return []
