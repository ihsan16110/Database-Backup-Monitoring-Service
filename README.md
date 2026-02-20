# Outlet DB Backup Monitoring

A full-stack web application to monitor database backup status across **1000+ outlet servers** in real time. The system scans remote servers over SMB, tracks backup health, and provides a centralized dashboard with historical reporting.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [Environment Variables](#environment-variables)
  - [Run with Docker (Recommended)](#run-with-docker-recommended)
  - [Run Locally (Development)](#run-locally-development)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Logging](#logging)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Real-time Scanning** - Scan 1000+ servers concurrently with live progress via Server-Sent Events (SSE)
- **Dual Backup Modes** - Monitor both D-Drive and IBSTORAGE (USB portable drive) backups
- **Dashboard** - At-a-glance stats with success/failure counts and daily trend charts
- **Backup Details** - Paginated table with status, last backup date, file name, and size
- **Reports & Export** - Filter by outlet, date range, or status and export to CSV
- **Selective Re-sync** - Re-scan individual outlets without running a full scan
- **Back-date Scanning** - Scan backup status for previous dates
- **Historical Tracking** - Daily records stored in SQL Server for trend analysis
- **Auto-detection** - Automatically detects USB drive letters for IBSTORAGE backups

## Tech Stack

| Layer      | Technology                                          |
|------------|-----------------------------------------------------|
| Frontend   | React 19, TypeScript, Tailwind CSS, Recharts        |
| Backend    | Python 3.13, Flask 3, Gunicorn                      |
| Database   | Microsoft SQL Server (ODBC Driver 17)               |
| Protocol   | SMB/CIFS via `smbprotocol`                          |
| Deployment | Docker Compose, Nginx (reverse proxy)               |

## Architecture

```
                    +-----------+
                    |  Browser  |
                    +-----+-----+
                          |
                    +-----v-----+
                    |   Nginx   |  Port 3004
                    |  (Frontend)|
                    +-----+-----+
                          |
            /backup-monitor/*    /api/*
                  |                 |
          +-------v------+  +------v-------+
          | React SPA    |  | Flask API    |  Port 5000
          | (Static)     |  | (Gunicorn)   |
          +--------------+  +------+-------+
                                   |
                    +--------------+--------------+
                    |                             |
             +------v-------+           +--------v--------+
             | SQL Server   |           | Outlet Servers   |
             | (DBBAK)      |           | (SMB on Port 445)|
             +--------------+           +-----------------+
```

## Prerequisites

- **Docker** and **Docker Compose** (for production/containerized setup)
- **Node.js 18+** and **npm** (for local frontend development)
- **Python 3.13+** (for local backend development)
- **SQL Server** with ODBC Driver 17 accessible from the host
- Network access to outlet servers on **port 445** (SMB)

## Getting Started

### Environment Variables

Create a `.env` file inside the backend directory:

```bash
# Outlet-Db-Backup-Monitoring-Backend/.env

# Database
DB_SERVER=192.168.x.x
DB_DATABASE=DBBAK
DB_USERNAME=sa
DB_PASSWORD=your_password

# D-Drive SMB Settings
SHARE=d$
FOLDER=BackupFull
USER=Administrator
PASS=your_password

# IBSTORAGE SMB Settings
SMB_USER=Administrator
SMB_PASS=your_password
IB_STORAGE_DRIVES=e$,f$,g$,h$,i$
IB_STORAGE_FOLDER=BackupFull

# CORS
CORS_ORIGINS=http://localhost:3004
```

### Run with Docker (Recommended)

From the project root directory:

```bash
# Build and start all services
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

Once running, open your browser:

| Service  | URL                                   |
|----------|---------------------------------------|
| App      | http://localhost:3004/backup-monitor   |
| API      | http://localhost:3004/api/v1           |

### Run Locally (Development)

**Backend:**

```bash
cd Outlet-Db-Backup-Monitoring-Backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate        # Linux/macOS
venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt

# Run the development server
python run.py
```

The API will be available at `http://localhost:5000`.

**Frontend:**

```bash
cd Outlet-DB-Backup-Monitoring-Frontend

# Install dependencies
npm install

# Start development server
npm start
```

The app will be available at `http://localhost:3000`.

## Project Structure

```
Outlet DB Backup Monitoring/
├── docker-compose.yml
├── README.md
│
├── Outlet-Db-Backup-Monitoring-Backend/
│   ├── Dockerfile
│   ├── run.py                          # Entry point
│   ├── requirements.txt
│   ├── .env                            # Environment config
│   └── app/
│       ├── __init__.py                 # Flask app factory
│       ├── config.py                   # Config loader
│       ├── logging_config.py           # Daily rotating logs
│       ├── routes/api/v1/
│       │   ├── backup_routes.py        # D-Drive API endpoints
│       │   └── ibstorage_routes.py     # IBSTORAGE API endpoints
│       └── services/
│           ├── backup_service.py       # D-Drive scan logic
│           └── Ib_Storage_backup_service.py  # IBSTORAGE scan logic
│
├── Outlet-DB-Backup-Monitoring-Frontend/
│   ├── Dockerfile                      # Multi-stage build
│   ├── nginx.conf                      # Reverse proxy config
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   └── src/
│       ├── App.tsx                     # Router setup
│       ├── pages/
│       │   ├── Dashboard.tsx           # Main dashboard
│       │   ├── Backups.tsx             # Backup detail view
│       │   ├── Servers.tsx             # Server status cards
│       │   ├── Reports.tsx             # Filtered reports + CSV
│       │   └── Settings.tsx            # App settings
│       ├── services/
│       │   └── apiServices.ts          # Axios HTTP client
│       └── context/
│           └── AuthContext.tsx          # Authentication state
│
└── logs/                               # Mounted log directory
```

## API Reference

All endpoints are prefixed with `/api/v1`.

### D-Drive Backup

| Method | Endpoint                    | Description                              |
|--------|-----------------------------|------------------------------------------|
| GET    | `/backup-status/scan`       | SSE stream - scan all servers with live progress |
| GET    | `/backup-stats`             | Fetch saved backup records (read-only)   |
| POST   | `/backup-status/sync`       | Re-scan specific outlets                 |
| GET    | `/backup-stats/daily-summary` | Aggregated daily success/failure counts |
| GET    | `/outlets`                  | List all outlet codes                    |

### IBSTORAGE Backup

| Method | Endpoint                       | Description                              |
|--------|--------------------------------|------------------------------------------|
| GET    | `/ibstorage-status/scan`       | SSE stream - scan all servers with live progress |
| GET    | `/ibstorage-stats`             | Fetch saved backup records (read-only)   |
| POST   | `/ibstorage-status/sync`       | Re-scan specific outlets                 |
| GET    | `/ibstorage-stats/daily-summary` | Aggregated daily success/failure counts |

### Common Query Parameters

| Parameter   | Type   | Description                        |
|-------------|--------|------------------------------------|
| `outlet`    | string | Filter by outlet code              |
| `date_from` | date   | Start date (YYYY-MM-DD)            |
| `date_to`   | date   | End date (YYYY-MM-DD)              |
| `scan_date` | date   | Scan for a specific past date      |
| `limit`     | int    | Limit results (default: 30)        |

### Sync Request Body

```json
POST /api/v1/backup-status/sync
{
  "outlets": ["OUTLET001", "OUTLET005"]
}
```

### Response Format

```json
{
  "status": "success",
  "data": [...],
  "advancedDate": [...],
  "count": 950,
  "advancedDateCount": 2,
  "processingTime": 45.32,
  "timestamp": "2026-02-21T10:30:00+00:00"
}
```

## Database Schema

The application uses two main tables with the same structure:

**`D_Drive_Backup_Stat`** / **`IB_Storage_Backup_Stat`**

| Column          | Type           | Description                     |
|-----------------|----------------|---------------------------------|
| OutletServer    | NVARCHAR(50)   | Outlet code (PK)                |
| ScanDate        | DATE           | Date of scan (PK)               |
| Status          | NVARCHAR(50)   | `Successful` or `Failed`        |
| LastBackupTaken | DATETIME       | Timestamp of latest backup file |
| BackupFile      | NVARCHAR(255)  | Backup file name                |
| BackupFileSize  | NVARCHAR(50)   | File size (e.g., `2.45 GB`)     |
| Duration        | NVARCHAR(50)   | Scan duration                   |
| ErrorDetails    | NVARCHAR(500)  | Error message if failed         |
| DriveLetter*    | NVARCHAR(10)   | USB drive letter (IBSTORAGE only) |

> Composite primary key on `(OutletServer, ScanDate)` ensures one record per outlet per day.

## Logging

Logs are written daily to the `logs/` directory:

```
logs/
├── D_Drive_Backup_log_2026-02-21.log
└── IB_Storage_Backup_log_2026-02-21.log
```

In Docker, the `logs/` directory is mounted as a volume for easy access from the host.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m "Add your feature"`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## License

This project is proprietary and intended for internal use.
