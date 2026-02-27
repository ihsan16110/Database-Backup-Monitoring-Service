import os
import time
import pyodbc
import traceback
from smbprotocol.exceptions import SMBConnectionClosed, SMBException
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date, timezone
from smbclient import register_session, delete_session, listdir, stat
from app.config import Config
from app.logging_config import get_d_drive_logger

class BackupMonitor:
    def __init__(self):
        self.config = Config()
        self.debug_mode = True
        self.logger = get_d_drive_logger()
        self.scan_date = None  # None = today; date object = back-date scan

    def log_error(self, message, severity="ERROR"):
        """Log errors with severity level"""
        if severity == "CRITICAL":
            self.logger.critical(message)
        else:
            self.logger.error(message)

    def get_db_connection(self):
        """Establish a secure database connection"""
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

    def get_outlets(self):
        """Fetch outlets from database with error handling"""
        try:
            conn = self.get_db_connection()
            if not conn:
                return []
            with conn:
                cursor = conn.cursor()
                cursor.execute("SELECT OutletCode, IPAddress FROM Outlets WHERE ActiveDepot = 'Y'")
                outlets = cursor.fetchall()
                self.logger.info(f"Outlets Fetched: {outlets}")
                return outlets
        except pyodbc.Error as e:
            self.logger.error(f"Database Error: {str(e)}")
            return []

    def check_server(self, outlet):
        """Check server status with retry logic"""
        outlet_code, server_ip = outlet
        result = {
            'outletCode': outlet_code,
            'server': server_ip,
            'lastModified': None,
            'status': 'Error',
            'errorDetails': None,
            'backupsize': None
        }

        # Step 1: Ping check
        self.logger.info(f"Checking server: {server_ip} (Outlet: {outlet_code})")
        if not self.ping_with_retry(server_ip):
            self.logger.error(f"Ping failed for {server_ip}")
            result['errorDetails'] = 'Server not Reachable'
            return result
        self.logger.info(f"Ping successful for {server_ip}")

        # Step 2: Network share connection
        server_name = server_ip
        
        try:
            self.logger.info(f"Attempting SMB connection to {server_name} as {self.config.SHARE_USERNAME}")
            register_session(
                server_name, 
                username=self.config.SHARE_USERNAME, 
                password=self.config.SHARE_PASSWORD
            )
            self.logger.info(f"SMB session registered for {server_name}")
            
            # smbclient path format: \\server\share\folder
            smb_base_path = f"\\\\{server_name}\\{self.config.SHARE_NAME}\\{self.config.FOLDER_PATH}"
            self.logger.info(f"Checking path: {smb_base_path}")
            
            # Step 3: Check backup folder
            try:
                files = listdir(smb_base_path)
                self.logger.info(f"Found {len(files)} files in {smb_base_path}")
            except Exception as e:
                self.logger.error(f"Listdir failed for {smb_base_path}: {str(e)}")
                result['errorDetails'] = f"Folder not found or inaccessible: {smb_base_path}"
                return result

            # Step 4: Get latest backup with validation
            latest_file, mod_time, backup_size = self.get_validated_backup(smb_base_path, cutoff_date=self.scan_date)
            if latest_file:
                self.logger.info(f"Found valid backup: {latest_file} ({backup_size} GB)")
                result['lastModified'] = mod_time.isoformat()
                result['status'] = 'Successful'
                result['file'] = os.path.basename(latest_file)
                result['backupsize'] = f"{backup_size} GB"
            else:
                self.logger.warning(f"No valid backup files found in {smb_base_path}")
                result['errorDetails'] = 'No Valid Backup Files Found'

        except (SMBConnectionClosed, SMBException) as smb_e:
            self.logger.error(f"SMB Protocol Error for {server_name}: {str(smb_e)}")
            result['errorDetails'] = f"SMB Protocol Error: {str(smb_e)}"
        except Exception as e:
            self.logger.error(f"Unexpected Error for {server_name}: {str(e)}")
            result['errorDetails'] = f"Error: {str(e)}"
        finally:
            try:
                self.logger.info(f"Cleaning up SMB session for {server_name}")
                delete_session(server_name)
            except Exception as cleanup_e:
                self.logger.debug(f"Session cleanup failed for {server_name}: {str(cleanup_e)}")

        return result

    def ping_with_retry(self, server_ip):
        """Ping with retry logic"""
        for attempt in range(self.config.MAX_RETRIES):
            if self.ping_server(server_ip):
                return True
            time.sleep(1)
        return False

    def ping_server(self, server_ip):
        """Check server reachability via TCP port 445 (SMB)"""
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            result = sock.connect_ex((server_ip, 445))
            sock.close()
            return result == 0
        except Exception as e:
            self.logger.error(f"TCP check failed for {server_ip}: {str(e)}")
            return False

    def get_validated_backup(self, smb_path, cutoff_date=None):
        """Find the latest valid backup file and its size using smbclient.

        When cutoff_date (a date object) is provided, only files modified on or
        before that date are considered. This enables back-date scanning.
        """
        try:
            latest_file = None
            latest_time = None
            min_size = 1024  # Minimum backup file size (1KB)

            # For back-date scans, compute end-of-day cutoff in UTC
            cutoff_dt = None
            if cutoff_date:
                cutoff_dt = datetime.combine(cutoff_date, datetime.max.time()).replace(tzinfo=timezone.utc)

            # Use smbclient.listdir to get files
            for file in listdir(smb_path):
                if file.lower().endswith('.bak'):
                    file_full_path = f"{smb_path}\\{file}"

                    # Use smbclient.stat to get metadata
                    file_info = stat(file_full_path)

                    if file_info.st_size < min_size:
                        continue

                    # smbclient returns timestamps in UTC
                    mod_time = datetime.fromtimestamp(file_info.st_mtime, tz=timezone.utc)

                    # Skip files newer than the cutoff for back-date scans
                    if cutoff_dt and mod_time > cutoff_dt:
                        continue

                    if not latest_time or mod_time > latest_time:
                        latest_file = file
                        latest_time = mod_time

            if latest_file:
                file_full_path = f"{smb_path}\\{latest_file}"
                file_size_bytes = stat(file_full_path).st_size
                file_size_gb = round(file_size_bytes / (1024 * 1024 * 1024), 2)
                return (latest_file, latest_time, file_size_gb)
            else:
                return None, None, None

        except (SMBConnectionClosed, SMBException) as smb_e:
            self.logger.error(f"SMB Protocol Error during backup search: {str(smb_e)}")
            raise  # Re-raise to be caught by check_server
        except Exception as e:
            self.logger.error(f"Backup Search Error: {str(e)}")
            return None, None, None

    def save_backup_status(self, results):
        """Save check results to D_Drive_Backup_Stat with daily historical tracking.

        Logic:
        - Same outlet + same day (ScanDate) → UPDATE only if values changed, skip if identical
        - Same outlet + new day → INSERT a new record (previous days' records stay untouched)
        """
        self.logger.info(f"Starting save_backup_status for {len(results)} results")
        today = self.scan_date if self.scan_date else date.today()

        try:
            conn = self.get_db_connection()
            if not conn:
                self.logger.error("Failed to get DB connection for saving status")
                return

            updated = inserted = skipped = 0
            with conn:
                cursor = conn.cursor()
                for res in results:
                    outlet_code = res['outletCode']
                    status = res['status'] # 'Successful' or 'Error'
                    last_backup = res.get('lastModified')
                    backup_file = res.get('file', 'N/A')
                    storage_used = res.get('backupsize', 'N/A')
                    error_details = res.get('errorDetails')

                    try:
                        # Fetch existing record for comparison
                        cursor.execute(
                            "SELECT Status, BackupFile, BackupFileSize, ErrorDetails FROM [dbo].[D_Drive_Backup_Stat] WHERE OutletServer = ? AND ScanDate = ?",
                            (outlet_code, today)
                        )
                        existing = cursor.fetchone()

                        if existing:
                            # Skip update if key fields are unchanged
                            if (existing[0] == status and
                                    (existing[1] or '') == (backup_file or '') and
                                    (existing[2] or '') == (storage_used or '') and
                                    (existing[3] or '') == (error_details or '')):
                                skipped += 1
                                continue

                            cursor.execute("""
                                UPDATE [dbo].[D_Drive_Backup_Stat]
                                SET Status = ?, LastBackupTaken = ?, BackupFile = ?, Duration = ?, BackupFileSize = ?, ErrorDetails = ?
                                WHERE OutletServer = ? AND ScanDate = ?
                            """, (status, last_backup, backup_file, None, storage_used, error_details, outlet_code, today))
                            updated += 1
                        else:
                            cursor.execute("""
                                INSERT INTO [dbo].[D_Drive_Backup_Stat]
                                (OutletServer, Status, LastBackupTaken, BackupFile, Duration, BackupFileSize, ScanDate, ErrorDetails)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """, (outlet_code, status, last_backup, backup_file, None, storage_used, today, error_details))
                            inserted += 1
                    except Exception as sql_e:
                        self.logger.error(f"SQL Error for outlet {outlet_code}: {str(sql_e)}")

                conn.commit()
                self.logger.info(f"D_Drive_Backup_Stat ScanDate={today}: {inserted} inserted, {updated} updated, {skipped} unchanged")
        except Exception as e:
            self.logger.error(f"Database Persistence Error: {str(e)}")
            self.logger.error(traceback.format_exc())

    def _parse_row(self, row):
        """Parse a database row into a result dict."""
        return {
            'outletCode': row[0],
            'server': row[1] or '',
            'status': row[2],
            'lastModified': row[3].isoformat() if isinstance(row[3], datetime) else row[3],
            'file': row[4],
            'backupsize': row[5],
            'scanDate': row[6].isoformat() if isinstance(row[6], date) else row[6],
            'errorDetails': row[7]
        }

    def _is_advanced_date(self, last_modified):
        """Check if a backup's LastBackupTaken year is beyond the current year."""
        if not last_modified:
            return False
        try:
            if isinstance(last_modified, str):
                last_modified = datetime.fromisoformat(last_modified)
            return last_modified.year > date.today().year
        except (ValueError, AttributeError):
            return False

    def _categorize_results(self, rows):
        """Split rows into normal and advancedDate groups."""
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
        """Fetch the latest scan date's backup stats from D_Drive_Backup_Stat.

        Returns a dict with two groups:
        - 'normal': outlets with backup dates in current year or past
        - 'advancedDate': outlets with backup dates beyond the current year
        """
        self.logger.info("Starting get_all_backup_stats")
        try:
            conn = self.get_db_connection()
            if not conn:
                self.logger.error("Failed to get DB connection for reading stats")
                return {'normal': [], 'advancedDate': []}
            with conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT b.OutletServer, o.IPAddress, b.Status, b.LastBackupTaken,
                           b.BackupFile, b.BackupFileSize, b.ScanDate, b.ErrorDetails
                    FROM [dbo].[D_Drive_Backup_Stat] b
                    LEFT JOIN [dbo].[Outlets] o ON b.OutletServer = o.OutletCode
                    WHERE b.ScanDate = (SELECT MAX(ScanDate) FROM [dbo].[D_Drive_Backup_Stat])
                    ORDER BY b.OutletServer
                """)
                rows = cursor.fetchall()
                normal, advanced_date = self._categorize_results(rows)
                self.logger.info(f"Fetched {len(normal)} normal + {len(advanced_date)} advanced-date records")
                return {'normal': normal, 'advancedDate': advanced_date}
        except Exception as e:
            self.logger.error(f"Database Read Error: {str(e)}")
            self.logger.error(traceback.format_exc())
            return {'normal': [], 'advancedDate': []}

    def get_outlets_by_codes(self, codes):
        """Fetch specific outlets by their codes for selective re-scanning."""
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
            self.logger.error(f"Database Error fetching outlets by codes: {str(e)}")
            return []

    def get_outlet_list(self):
        """Fetch all outlet codes for filter dropdowns"""
        try:
            conn = self.get_db_connection()
            if not conn:
                return []
            with conn:
                cursor = conn.cursor()
                cursor.execute("SELECT OutletCode FROM Outlets WHERE ActiveDepot = 'Y' ORDER BY OutletCode")
                return [row[0] for row in cursor.fetchall()]
        except Exception as e:
            self.logger.error(f"Outlet list error: {str(e)}")
            return []

    def get_filtered_backup_stats(self, outlet=None, date_from=None, date_to=None):
        """Fetch backup stats with optional filters.

        Returns a dict with 'normal' and 'advancedDate' groups,
        filtered by ScanDate range.
        """
        try:
            conn = self.get_db_connection()
            if not conn:
                return {'normal': [], 'advancedDate': []}
            with conn:
                cursor = conn.cursor()
                query = """
                    SELECT b.OutletServer, o.IPAddress, b.Status, b.LastBackupTaken,
                           b.BackupFile, b.BackupFileSize, b.ScanDate, b.ErrorDetails
                    FROM [dbo].[D_Drive_Backup_Stat] b
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
            self.logger.error(f"Filtered backup stats error: {str(e)}")
            self.logger.error(traceback.format_exc())
            return {'normal': [], 'advancedDate': []}

    def get_daily_summary(self, limit=30):
        """Return per-day aggregated backup counts.

        Returns a list of dicts sorted by ScanDate descending:
        [{ scanDate, total, successful, failed }, ...]
        """
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
                    FROM [dbo].[D_Drive_Backup_Stat]
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
            self.logger.error(f"Daily summary error: {str(e)}")
            self.logger.error(traceback.format_exc())
            return []