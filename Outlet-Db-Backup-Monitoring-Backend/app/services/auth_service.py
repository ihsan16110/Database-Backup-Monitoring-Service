import pyodbc
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta
from app.config import Config


class AuthService:
    def __init__(self):
        self.config = Config()

    def get_db_connection(self):
        """Establish database connection (same pattern as BackupMonitor)."""
        conn_str = (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={self.config.DB_SERVER};"
            f"DATABASE={self.config.DB_DATABASE};"
            f"UID={self.config.DB_USERNAME};"
            f"PWD={self.config.DB_PASSWORD};"
            "Encrypt=no;TrustServerCertificate=yes;"
        )
        return pyodbc.connect(conn_str)

    def authenticate_user(self, user_id, password):
        """Verify user credentials against UserManager table.

        Returns user dict on success, None on failure.
        """
        try:
            conn = self.get_db_connection()
            with conn:
                cursor = conn.cursor()
                cursor.execute(
                    """SELECT UserID, UserName, Designation, UserType,
                              Password, Status, Avatar, LoginFalseAttempt
                       FROM [dbo].[UserManager]
                       WHERE UserID = ?""",
                    (user_id,)
                )
                row = cursor.fetchone()

                if not row:
                    return None

                stored_hash = row[4]       # Password column
                status = (row[5] or '').strip()
                false_attempts = row[7] or 0

                # Check if account is active
                if status != 'Y':
                    return None

                # Check if account is locked (5+ failed attempts)
                if false_attempts >= 5:
                    return None

                # Verify bcrypt password
                if not bcrypt.checkpw(
                    password.encode('utf-8'),
                    stored_hash.encode('utf-8')
                ):
                    self._increment_false_attempts(user_id, false_attempts)
                    return None

                # Success -- reset false attempts and update login time
                self._record_successful_login(user_id)

                return {
                    'userId': row[0].strip(),
                    'userName': row[1].strip() if row[1] else '',
                    'designation': row[2].strip() if row[2] else '',
                    'userType': row[3].strip(),  # 'A' or 'S'
                    'avatar': row[6],
                }

        except pyodbc.Error:
            return None

    def _increment_false_attempts(self, user_id, current_count):
        """Increment LoginFalseAttempt counter on wrong password."""
        try:
            conn = self.get_db_connection()
            with conn:
                cursor = conn.cursor()
                cursor.execute(
                    """UPDATE [dbo].[UserManager]
                       SET LoginFalseAttempt = ?
                       WHERE UserID = ?""",
                    (current_count + 1, user_id)
                )
                conn.commit()
        except pyodbc.Error:
            pass

    def _record_successful_login(self, user_id):
        """Reset false attempts and update LoginActiveTime on success."""
        try:
            conn = self.get_db_connection()
            with conn:
                cursor = conn.cursor()
                cursor.execute(
                    """UPDATE [dbo].[UserManager]
                       SET LoginFalseAttempt = 0,
                           LoginActiveTime = ?
                       WHERE UserID = ?""",
                    (datetime.now(), user_id)
                )
                conn.commit()
        except pyodbc.Error:
            pass

    def generate_token(self, user_dict):
        """Generate a JWT access token containing user identity and role."""
        payload = {
            'userId': user_dict['userId'],
            'userName': user_dict['userName'],
            'userType': user_dict['userType'],
            'iat': datetime.now(timezone.utc),
            'exp': datetime.now(timezone.utc) + timedelta(
                hours=self.config.JWT_EXPIRATION_HOURS
            ),
        }
        return jwt.encode(payload, self.config.JWT_SECRET_KEY, algorithm='HS256')

    def decode_token(self, token):
        """Decode and validate a JWT token.

        Returns the payload dict or None if invalid/expired.
        """
        try:
            payload = jwt.decode(
                token,
                self.config.JWT_SECRET_KEY,
                algorithms=['HS256']
            )
            return payload
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            return None
