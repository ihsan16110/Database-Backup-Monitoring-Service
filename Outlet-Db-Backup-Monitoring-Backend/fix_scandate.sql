-- Fix: Reset ScanDate for records that got future dates from the old migration
-- Run this ONLY if you already ran the previous migration that backfilled from LastBackupTaken

UPDATE [dbo].[D_Drive_Backup_Stat]
SET ScanDate = CAST(GETDATE() AS DATE)
WHERE ScanDate > CAST(GETDATE() AS DATE);
GO
