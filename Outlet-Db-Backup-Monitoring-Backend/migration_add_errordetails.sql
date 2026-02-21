-- Migration: Add ErrorDetails column to D_Drive_Backup_Stat
-- Run this script ONCE on the DBBAK database
-- This allows storing specific error reasons (e.g. "Server not Reachable", "No Directory", etc.)

ALTER TABLE [dbo].[D_Drive_Backup_Stat]
ADD ErrorDetails NVARCHAR(500) NULL;
GO
