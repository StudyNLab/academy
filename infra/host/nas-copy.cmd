@echo off
rem AIONIT 백업 두 번째 사본 (M10, 2026-11-05 운영자 결정): 호스트 G:\AIONIT-backup ➔ F:\AIONIT-backup
rem 호스트 TrainingGround 의 예약 작업 "AIONIT-NAS-copy" 가 매일 04:30 (data VM 03:30 백업 뒤) 부른다. 위치 C:\AIONIT\nas-copy.cmd
rem - 복사만 한다 (G: 에서 지운 파일을 F: 에서 따라 지우지 않는다: G: 가 망가지거나 지워져도 F: 는 남게)
rem - F: 는 200일 지난 파일만 지운다 (G: 의 월간 DB 백업 6개월보다 조금 길게)
rem - 복사 뒤 DB 백업마다 sha256 을 다시 계산해 확인한다 (다르면 종료 코드 2, 기록에 verify-failed)
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
rem 복사한 DB 백업을 sha256 으로 확인한다 (.sha256 파일의 값과 F: 의 파일을 다시 계산한 값). 하나라도 다르면 실패
powershell -NoProfile -Command "$bad=0; Get-ChildItem '%DST%\db' -Filter *.dump.sha256 | ForEach-Object { $exp=(Get-Content $_.FullName -Raw).Split(' ')[0].Trim(); $f=$_.FullName -replace '\.sha256$',''; if (!(Test-Path $f) -or (Get-FileHash $f -Algorithm SHA256).Hash.ToLower() -ne $exp) { $bad++; Add-Content '%DST%\_nas-copy.log' ('verify-failed ' + $f) } }; Add-Content '%DST%\_nas-copy.log' ((Get-Date -Format s) + ' sha256 verify bad=' + $bad); exit [int]($bad -gt 0)"
if %ERRORLEVEL% NEQ 0 exit /b 2
forfiles /p "%DST%" /s /m *.* /d -200 /c "cmd /c if @isdir==FALSE del /q @path" 2>nul
exit /b 0
