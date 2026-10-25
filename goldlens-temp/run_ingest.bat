@echo off
cd /d C:\Users\ADMIN\Desktop\GoldLens\goldlens-temp
call npx.cmd tsx backend/ingest/ingest.tsx --days 3 >> ingest.log 2>&1
