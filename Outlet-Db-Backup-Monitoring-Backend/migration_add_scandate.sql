-- Migration: Add ScanDate column to D_Drive_Backup_Stat for historical record keeping
-- Run this script ONCE on the DBBAK database before deploying the updated backend code

-- Step 1: Add ScanDate column with default value of today for existing records
-- ScanDate = the date the scan was performed, NOT the backup date
ALTER TABLE [dbo].[D_Drive_Backup_Stat]
ADD ScanDate DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE);
GO

-- Step 2: All existing records get today's date as ScanDate
-- (They all came from the pre-history-tracking era, so today is correct)
-- No backfill from LastBackupTaken — that caused future dates (2098, 2068, etc.) to leak in

-- Step 3: Drop existing primary key constraint on OutletServer
DECLARE @pkName NVARCHAR(256)
SELECT @pkName = kc.name
FROM sys.key_constraints kc
JOIN sys.tables t ON kc.parent_object_id = t.object_id
WHERE t.name = 'D_Drive_Backup_Stat' AND kc.type = 'PK'

IF @pkName IS NOT NULL
BEGIN
    EXEC('ALTER TABLE [dbo].[D_Drive_Backup_Stat] DROP CONSTRAINT ' + @pkName)
END
GO

-- Step 4: Add new composite primary key (OutletServer + ScanDate)
ALTER TABLE [dbo].[D_Drive_Backup_Stat]
ADD CONSTRAINT PK_D_Drive_Backup_Stat PRIMARY KEY (OutletServer, ScanDate);
GO
