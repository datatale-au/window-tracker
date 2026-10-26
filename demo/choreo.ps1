# Plays the demo scenes in the isolated demo world and records each one with ffmpeg.
# Fake Claude sessions are written straight into the demo tracker state, so the real
# extension UI reacts exactly as it would to real sessions. Mouse moves and clicks are
# real (on the capture monitor) and logged to events.jsonl so the editor can draw a cursor.
#   -Scenes    which scenes to run, e.g. 'overview,question' (default: all)
#   -NoRecord  dry run without ffmpeg
param(
  [string]$Root = 'C:\DemoTracker',
  [string]$Out = (Join-Path $PSScriptRoot '..\video\capture'),
  [string]$Scenes = 'problem,overview,question,background,details,layouts',
  [switch]$NoRecord,
  [int]$Output = 0   # DXGI output of the capture monitor (the one the demo windows are on)
)
$ErrorActionPreference = 'Stop'
$Out = [IO.Path]::GetFullPath($Out)
New-Item -ItemType Directory -Force $Out | Out-Null
$ffmpeg = & python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
$state = Join-Path $Root 'state'
$sessions = Join-Path $state 'sessions'
$transcripts = Join-Path $Root 'transcripts'
New-Item -ItemType Directory -Force $sessions, $transcripts | Out-Null
$focusScript = Join-Path $PSScriptRoot '..\scripts\focus-window.ps1'

Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class In {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
}
'@
[void][In]::SetProcessDPIAware()

$projects = 'Finance Report', 'Training Video', 'HR Analytics', 'Client Proposal'
$script:clock = $null
$script:scene = ''
$script:cursor = @(960, 540)
$MonX = 0; $MonY = 0   # set from the demo windows' monitor once they're found

function Now-Ms { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
function Log($type, $data) {
  $t = if ($script:clock) { [math]::Round($script:clock.Elapsed.TotalSeconds, 3) } else { 0 }
  $o = [ordered]@{ scene = $script:scene; t = $t; type = $type }
  foreach ($k in $data.Keys) { $o[$k] = $data[$k] }
  Add-Content -Path (Join-Path $Out 'events.jsonl') -Value ($o | ConvertTo-Json -Compress)
}
function Write-Json($path, $obj) { [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 6 -Compress)) }

# --- fake Claude sessions -------------------------------------------------------
function Set-Session($project, $st, [string]$prompt = '', [hashtable]$tasks = @{}, [string]$said = '', [int]$agoSec = 5) {
  $id = 'demo-' + ($project -replace '\W', '').ToLower()
  $tr = Join-Path $transcripts "$id.jsonl"
  if ($said) {
    $line = @{ type = 'assistant'; timestamp = (Get-Date).ToString('o'); message = @{ role = 'assistant'; content = @(@{ type = 'text'; text = $said }) } } | ConvertTo-Json -Depth 6 -Compress
    [IO.File]::WriteAllText($tr, $line + "`n")
  }
  $bg = @{}
  foreach ($k in $tasks.Keys) { $bg[$k] = @{ ts = (Now-Ms) - 1000 * $tasks[$k].ago; name = $tasks[$k].name } }
  Write-Json (Join-Path $sessions "$id.json") ([ordered]@{
    sessionId = $id; cwd = (Join-Path $Root "projects\$project"); transcriptPath = $tr
    state = $st; since = (Now-Ms) - 1000 * $agoSec; seen = $false; prompt = $prompt
    background = $bg; scanOffset = 0; event = 'demo'; ts = (Now-Ms)
  })
  Log 'state' @{ project = $project; state = $st }
}
function Set-Docs($docs) { Write-Json (Join-Path $state 'docs.json') @($docs) }
function Doc($kind, $project, $name, $problem = '') {
  @{ kind = $kind; pid = 0; hwnd = 0; path = (Join-Path $Root "projects\$project\$name"); name = $name; problem = $problem }
}

# --- input ----------------------------------------------------------------------
function Move-To($x, $y, [double]$secs = 0.6) {
  $from = $script:cursor; $steps = [math]::Max(1, [int]($secs * 60))
  for ($i = 1; $i -le $steps; $i++) {
    $p = $i / $steps; $e = 1 - [math]::Pow(1 - $p, 3)
    [void][In]::SetCursorPos($MonX + [int]($from[0] + ($x - $from[0]) * $e), $MonY + [int]($from[1] + ($y - $from[1]) * $e))
    Start-Sleep -Milliseconds 16
  }
  $script:cursor = @($x, $y)
  Log 'move' @{ x = $x; y = $y; dur = $secs }
}
function Click($x, $y, $label = '') {
  Move-To $x $y
  Start-Sleep -Milliseconds 120
  [In]::mouse_event(0x2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 70; [In]::mouse_event(0x4, 0, 0, 0, [UIntPtr]::Zero)
  Log 'click' @{ x = $x; y = $y; label = $label }
}
function Keys($keys, $label) { [System.Windows.Forms.SendKeys]::SendWait($keys); Log 'key' @{ keys = $label } }
function Wait($s) { Start-Sleep -Milliseconds ([int]($s * 1000)) }
# The largest visible window with the project's title (ignores stray helper windows).
function Find-Window($project) {
  $script:hit = [IntPtr]::Zero; $script:area = 0
  [void][In]::EnumWindows({ param($h, $l)
    if ([In]::IsWindowVisible($h)) { $sb = New-Object Text.StringBuilder 512; [void][In]::GetWindowText($h, $sb, 512)
      if ($sb.ToString() -eq "$project - Visual Studio Code") {
        $r = New-Object In+RECT; [void][In]::GetWindowRect($h, [ref]$r)
        $a = ($r.R - $r.L) * ($r.B - $r.T)
        if ($a -gt $script:area) { $script:hit = $h; $script:area = $a } } }
    $true }, [IntPtr]::Zero)
  $script:hit
}
function Focus($project) {
  $h = Find-Window $project
  if ($h -ne [IntPtr]::Zero) { [void](& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $focusScript -Hwnd ([long]$h)) }
  Log 'focus' @{ project = $project }
}
# Which side bar view demo windows show when they come to the front (read by the extension).
function Set-View($view) { [IO.File]::WriteAllText((Join-Path $state 'demo-view'), $view) }

# --- recording ------------------------------------------------------------------
function Record($name, $secs, [scriptblock]$steps) {
  $script:scene = $name
  Write-Host "scene $name ($secs s)"
  $file = Join-Path $Out "$name.mp4"
  $proc = $null
  if (-not $NoRecord) {
    $args = @('-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "ddagrab=output_idx=$($Output):framerate=30:draw_mouse=0,hwdownload,format=bgra",
              '-t', "$secs", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', "`"$file`"")
    $proc = Start-Process -FilePath $ffmpeg -ArgumentList $args -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 700   # ffmpeg start-up, so step times line up with the video
  }
  $script:clock = [Diagnostics.Stopwatch]::StartNew()
  Log 'start' @{}
  & $steps
  if ($proc) { $proc.WaitForExit(); Write-Host "  -> $file" }
  $script:clock = $null
}

# --- scenes ---------------------------------------------------------------------
# Panel geometry on the capture monitor (1920x1080, side bar about 600px wide).
$rowX = 200; $firstOther = 148; $rowStep = 27.5; $chevX = 83

function Reset-World {
  Get-ChildItem $sessions -File | Remove-Item -Force
  Set-Docs @()
  foreach ($p in $projects) { Set-Session $p 'idle' '' @{} '' 600 }
}

$all = [ordered]@{
  problem = {
    # Four identical-looking windows, cycled: hard to tell which one needs you.
    Set-View 'explorer'
    foreach ($p in $projects) { Focus $p; Wait 0.8 }
    Record 'problem' 10 {
      foreach ($i in 1..2) { foreach ($p in $projects) { Focus $p; Wait 1.1 } }
      Wait 1
    }
    Set-View 'tracker'
    foreach ($p in $projects) { Focus $p; Wait 0.8 }
  }
  overview = {
    Set-Session 'Finance Report' 'working' '' @{} '' 40
    Set-Session 'Training Video' 'background' '' @{ b1 = @{ name = 'Render English cut (1080p)'; ago = 720 }; b2 = @{ name = 'Render Spanish cut (1080p)'; ago = 540 } } 'Both renders are running. I will check the audio levels once they finish.' 60
    Set-Session 'HR Analytics' 'done' '' @{} 'Headcount by department is fixed. Leavers now come from the termination date, not the status flag.' 90
    Set-Session 'Client Proposal' 'idle' '' @{} 'The proposal now has the six-week plan and the pricing table on slide 6.' 300
    Set-Docs @((Doc 'pbi' 'Finance Report' 'Finance Report.pbip'), (Doc 'excel' 'Finance Report' 'budget.csv'), (Doc 'word' 'Training Video' 'script.docx'), (Doc 'pbi' 'HR Analytics' 'HR Analytics.pbip'), (Doc 'powerpoint' 'Client Proposal' 'Proposal.pptx'))
    Focus 'Client Proposal'; Wait 2
    Record 'overview' 9 {
      Move-To 300 300 1.0; Wait 1.5
      Move-To $rowX ($firstOther + $rowStep) 0.8; Wait 1.2
      Move-To $rowX ($firstOther + 2 * $rowStep) 0.6; Wait 2
      Move-To 330 520 0.6
    }
  }
  question = {
    Record 'question' 12 {
      Wait 1
      Set-Session 'Finance Report' 'question' 'Overwrite the existing Finance Report.pbip with the new layout? (Yes / No, save a copy)' @{} '' 1
      Wait 4
      Click $rowX $firstOther 'Finance Report'
      Wait 0.3; Move-To 330 600 0.5
      Wait 3.5
    }
  }
  background = {
    Set-Session 'Finance Report' 'working' '' @{} '' 5
    Set-Session 'HR Analytics' 'working' '' @{} '' 30
    Record 'background' 13 {
      Wait 1.5
      Set-Session 'Training Video' 'background' '' @{ b2 = @{ name = 'Render Spanish cut (1080p)'; ago = 560 } } 'English cut is done. Spanish is still rendering.' 80
      Wait 3
      Set-Session 'Training Video' 'done' '' @{} 'Both cuts are rendered and the audio levels are within -16 LUFS. Ready for review.' 1
      Wait 4
      Click $rowX $firstOther 'Training Video'
      Wait 0.3; Move-To 330 600 0.5
      Wait 2.5
    }
  }
  details = {
    Record 'details' 14 {
      Wait 1
      # Expand the other windows one by one.
      Click $chevX $firstOther 'expand first'; Wait 0.3
      Move-To 330 600 0.5; Wait 1.5
      Set-Docs @((Doc 'pbi' 'Finance Report' 'Finance Report.pbip'), (Doc 'excel' 'Finance Report' 'budget.csv'), (Doc 'word' 'Training Video' 'script.docx'), (Doc 'pbi' 'HR Analytics' 'HR Analytics.pbip' 'Issues were found'), (Doc 'powerpoint' 'Client Proposal' 'Proposal.pptx'))
      Wait 5
      Wait 4
    }
  }
  layouts = {
    Record 'layouts' 24 {
      Wait 1
      Keys '^%l' 'Ctrl+Alt+L (tile)'; Wait 10
      Keys '^%l' 'Ctrl+Alt+L (stack)'; Wait 12
    }
  }
}

# Mouse coordinates are relative to the monitor the demo windows are on (physical pixels).
$anchor = Find-Window 'Client Proposal'
if ($anchor -eq [IntPtr]::Zero) { throw 'Demo windows not found; run demolaunch.ps1 first.' }
$mi = New-Object In+MONITORINFO; $mi.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($mi)
[void][In]::GetMonitorInfo([In]::MonitorFromWindow($anchor, 2), [ref]$mi)
$MonX = $mi.rcMonitor.L; $MonY = $mi.rcMonitor.T
"capture monitor at $MonX,$MonY ($($mi.rcMonitor.R - $mi.rcMonitor.L)x$($mi.rcMonitor.B - $mi.rcMonitor.T))"

Remove-Item (Join-Path $Out 'events.jsonl') -ErrorAction SilentlyContinue
Reset-World
Set-View 'tracker'
Wait 2
foreach ($s in $Scenes.Split(',')) { & $all[$s.Trim()] }
"done: $Scenes"
