# Closes only the demo VS Code instance (processes started with the demo --user-data-dir).
# Real VS Code windows are never touched.
param([string]$Root = 'C:\DemoTracker')
$demo = Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Root*" }
# Stop the main process (no --type=) first; its children exit with it.
$main = $demo | Where-Object { $_.CommandLine -notmatch '--type=' }
foreach ($p in $main) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
foreach ($p in $demo) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Get-ChildItem (Join-Path $Root 'state\windows') -File -ErrorAction SilentlyContinue | Remove-Item -Force
"stopped $(@($main).Count) demo main process(es), $(@($demo).Count) total"
