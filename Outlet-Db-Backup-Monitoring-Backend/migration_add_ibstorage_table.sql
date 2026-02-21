-- Migration: Create IB_Storage_Backup_Stat table for IBSTORAGE (USB portable drive) backup monitoring
-- Run this script ONCE on the DBBAK database via SSMS

CREATE TABLE [dbo].[IB_Storage_Backup_Stat] (
    OutletServer    NVARCHAR(50)   NOT NULL,
    Status          NVARCHAR(50)   NULL,
    LastBackupTaken DATETIME       NULL,
    BackupFile      NVARCHAR(255)  NULL,
    Duration        NVARCHAR(50)   NULL,
    BackupFileSize  NVARCHAR(50)   NULL,
    ScanDate        DATE           NOT NULL DEFAULT CAST(GETDATE() AS DATE),
    ErrorDetails    NVARCHAR(500)  NULL,
    DriveLetter     NVARCHAR(10)   NULL,
    CONSTRAINT PK_IB_Storage_Backup_Stat PRIMARY KEY (OutletServer, ScanDate)
);
GO
