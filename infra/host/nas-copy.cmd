@echo off
rem AIONIT 백업 두 번째 사본 (M10, 2026-11-05 운영자 결정): 호스트 G:\AIONIT-backup ➔ F:\AIONIT-backup
rem 호스트 TrainingGround 의 예약 작업 "AIONIT-NAS-copy" 가 매일 04:30 (data VM 03:30 백업 뒤) 부른다. 위치 C:\AIONIT\nas-copy.cmd
rem - 복사만 한다 (G: 에서 지운 파일을 F: 에서 따라 지우지 않는다: G: 가 망가지거나 지워져도 F: 는 남게)
rem - F: 는 200일 지난 파일만 지운다 (G: 의 월간 DB 백업 6개월보다 조금 길게)
setlocal
set SRC=G:\AIONIT-backup
set DST=F:\AIONIT-backup
if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%" "%DST%" /E /COPY:DAT /DCOPY:T /R:2 /W:10 /NP /NDL /XF _nas-copy.log /LOG+:"%DST%\_nas-copy.log"
rem robocopy 종료 코드 8 이상이 실패
if %ERRORLEVEL% GEQ 8 (
  echo %DATE% %TIME% 실패 코드 %ERRORLEVEL% >> "%DST%\_nas-copy.log"
  exit /b 1
)
forfiles /p "%DST%" /s /m *.* /d -200 /c "cmd /c if @isdir==FALSE del /q @path" 2>nul
exit /b 0
