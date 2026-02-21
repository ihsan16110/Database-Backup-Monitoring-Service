# Database-Backup-Monitoring
This Application will monitor the Overall Database Backups of 1000 Outlet Servers for Shwapno


# Here is the backend structure
backup-monitor/
│
├── app/
│   ├── __init__.py
│   ├── config.py
│   ├── extensions.py
│   ├── models/
│   │   ├── __init__.py
│   │   └── outlet.py
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── v1/
│   │   │       ├── __init__.py
│   │   │       ├── backup_routes.py
│   │   │       └── endpoints.py
│   ├── services/
│   │   ├── __init__.py
│   │   └── backup_service.py
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── network_utils.py
│   │   └── error_handler.py
│   └── tests/
│       ├── __init__.py
│       ├── unit/
│       │   ├── test_services.py
│       │   └── test_utils.py
│       └── integration/
│           └── test_api.py
│
├── migrations/
├── requirements.txt
├── requirements-dev.txt
├── .env
├── .flaskenv
├── pytest.ini
├── README.md
└── run.py
