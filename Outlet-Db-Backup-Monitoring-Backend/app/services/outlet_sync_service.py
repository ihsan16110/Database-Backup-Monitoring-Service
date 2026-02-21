import pyodbc
from app.config import Config
from app.logging_config import get_d_drive_logger


class OutletSyncService:
    """Syncs outlets from the central EPSMirror database to the local Outlets table.

    Read-only access to central Depot / DepotIP tables.
    Inserts new outlets, updates changed fields, and deactivates removed outlets locally.
    """

    def __init__(self):
        self.config = Config()
        self.logger = get_d_drive_logger()

    # ------------------------------------------------------------------
    # Database connections
    # ------------------------------------------------------------------

    def _get_central_connection(self):
        """Connect to the central EPSMirror database (read-only)."""
        conn_str = (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={self.config.CENTRAL_DB_SERVER};"
            f"DATABASE={self.config.CENTRAL_DB_DATABASE};"
            f"UID={self.config.CENTRAL_DB_USERNAME};"
            f"PWD={self.config.CENTRAL_DB_PASSWORD};"
            "Encrypt=no;TrustServerCertificate=yes;"
        )
        return pyodbc.connect(conn_str)

    def _get_local_connection(self):
        """Connect to the local DBBAK database."""
        conn_str = (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={self.config.DB_SERVER};"
            f"DATABASE={self.config.DB_DATABASE};"
            f"UID={self.config.DB_USERNAME};"
            f"PWD={self.config.DB_PASSWORD};"
            "Encrypt=no;TrustServerCertificate=yes;"
        )
        return pyodbc.connect(conn_str)

    # ------------------------------------------------------------------
    # Fetch helpers
    # ------------------------------------------------------------------

    def _fetch_central_outlets(self, conn):
        """Fetch all outlets from central Depot + DepotIP (both active and inactive)."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT D.DepotCode  AS OutletCode,
                   DI.IPAddress AS IPAddress,
                   D.DepotName  AS OutletName,
                   D.ActiveDepot AS ActiveDepot
            FROM Depot D
            INNER JOIN DepotIP DI ON D.DepotCode = DI.DepotCode
        """)
        rows = cursor.fetchall()
        return {
            row[0]: {
                'OutletCode': row[0],
                'IPAddress': row[1],
                'OutletName': row[2],
                'ActiveDepot': row[3],
            }
            for row in rows
        }

    def _fetch_local_outlets(self, conn):
        """Fetch all outlets from the local Outlets table."""
        cursor = conn.cursor()
        cursor.execute("SELECT OutletCode, IPAddress, OutletName, ActiveDepot FROM Outlets")
        rows = cursor.fetchall()
        return {
            row[0]: {
                'OutletCode': row[0],
                'IPAddress': row[1],
                'OutletName': row[2],
                'ActiveDepot': row[3],
            }
            for row in rows
        }

    # ------------------------------------------------------------------
    # Main sync
    # ------------------------------------------------------------------

    def sync_outlets(self):
        """Sync outlets from central to local.

        Returns a dict with counts: { inserted, updated, deactivated }
        or None if the sync could not run (e.g. central unreachable).
        """
        if not self.config.CENTRAL_DB_SERVER:
            self.logger.warning("Central DB not configured — skipping outlet sync")
            return None

        try:
            central_conn = self._get_central_connection()
        except Exception as e:
            self.logger.error(f"Cannot connect to central server: {e}")
            return None

        try:
            central_outlets = self._fetch_central_outlets(central_conn)
            self.logger.info(f"Fetched {len(central_outlets)} outlets from central server")
        except Exception as e:
            self.logger.error(f"Error fetching central outlets: {e}")
            central_conn.close()
            return None
        finally:
            central_conn.close()

        try:
            local_conn = self._get_local_connection()
        except Exception as e:
            self.logger.error(f"Cannot connect to local DB for sync: {e}")
            return None

        inserted = 0
        updated = 0
        deactivated = 0

        try:
            local_outlets = self._fetch_local_outlets(local_conn)
            cursor = local_conn.cursor()

            # 1. Insert new outlets & update changed outlets
            for code, central in central_outlets.items():
                local = local_outlets.get(code)

                if not local:
                    # New outlet — INSERT
                    cursor.execute(
                        "INSERT INTO Outlets (OutletCode, IPAddress, OutletName, ActiveDepot) VALUES (?, ?, ?, ?)",
                        (central['OutletCode'], central['IPAddress'], central['OutletName'], central['ActiveDepot'])
                    )
                    inserted += 1
                elif (local['IPAddress'] != central['IPAddress'] or
                      local['OutletName'] != central['OutletName'] or
                      local['ActiveDepot'] != central['ActiveDepot']):
                    # Changed — UPDATE
                    cursor.execute(
                        "UPDATE Outlets SET IPAddress = ?, OutletName = ?, ActiveDepot = ? WHERE OutletCode = ?",
                        (central['IPAddress'], central['OutletName'], central['ActiveDepot'], code)
                    )
                    updated += 1

            # 2. Deactivate local outlets that no longer exist in central
            for code, local in local_outlets.items():
                if local['ActiveDepot'] == 'Y' and code not in central_outlets:
                    cursor.execute(
                        "UPDATE Outlets SET ActiveDepot = 'N' WHERE OutletCode = ?",
                        (code,)
                    )
                    deactivated += 1

            local_conn.commit()

            if inserted or updated or deactivated:
                self.logger.info(
                    f"Outlet sync complete — inserted: {inserted}, updated: {updated}, deactivated: {deactivated}"
                )
            else:
                self.logger.info("Outlet sync complete — no changes detected")

            return {'inserted': inserted, 'updated': updated, 'deactivated': deactivated}

        except Exception as e:
            self.logger.error(f"Outlet sync error: {e}")
            try:
                local_conn.rollback()
            except Exception:
                pass
            return None
        finally:
            local_conn.close()
