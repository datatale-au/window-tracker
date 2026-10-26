# Opens the four demo projects in the isolated VS Code instance and maximises them all
# on the capture monitor. Demo windows only see each other (VS_TRACKER_HOME).
param(
  [string]$Root = 'C:\DemoTracker',
  [int]$X = 2048, [int]$Y = -1, [int]$W = 1920, [int]$H = 1080   # capture monitor (DISPLAY8)
)

$exe = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe'
$env:VS_TRACKER_HOME = Join-Path $Root 'state'
$env:VS_TRACKER_DEMO = '1'
# Start clean: variables inherited from another VS Code (e.g. its IPC handle) must not leak in.
Get-ChildItem Env: | Where-Object { $_.Name -like "VSCODE_*" -or $_.Name -eq "ELECTRON_RUN_AS_NODE" } | ForEach-Object { Remove-Item "Env:$($_.Name)" }

$open = [ordered]@{
  'Client Proposal' = 'proposal.md'
  'HR Analytics'    = 'headcount.sql'
  'Training Video'  = 'render.py'
  'Finance Report'  = 'measures.dax'
}
foreach ($name in $open.Keys) {
  $dir = Join-Path $Root "projects\$name"
  Start-Process -FilePath $exe -ArgumentList @('--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--user-data-dir', "`"$Root\vscode`"", '--extensions-dir', "`"$Root\ext`"", '--new-window', "`"$dir`"", "`"$(Join-Path $dir $open[$name])`"")
  Start-Sleep -Seconds 4
}
Start-Sleep -Seconds 4

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DemoWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[void][DemoWin]::SetProcessDPIAware()
$names = @($open.Keys)
$found = @()
[void][DemoWin]::EnumWindows({
  param($h, $l)
  if ([DemoWin]::IsWindowVisible($h)) {
    $sb = New-Object Text.StringBuilder 512; [void][DemoWin]::GetWindowText($h, $sb, 512); $t = $sb.ToString()
    foreach ($n in $names) { if ($t -eq "$n - Visual Studio Code") { $script:found += ,@($h, $n) } }
  }
  $true
}, [IntPtr]::Zero)
foreach ($f in $found) {
  [void][DemoWin]::ShowWindow($f[0], 9)
  [void][DemoWin]::SetWindowPos($f[0], [IntPtr]::Zero, $X + 40, $Y + 40, $W - 80, $H - 80, 0x0004)
  [void][DemoWin]::ShowWindow($f[0], 3)
}
"placed $($found.Count) demo window(s): $(($found | ForEach-Object { $_[1] }) -join ', ')"
