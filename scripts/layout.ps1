# Arranges the tracked VS Code windows on the monitor of the foreground window.
#   -Mode tile   grid them across the monitor's work area
#   -Mode stack  maximise them all on that monitor
# -Names is the workspace names separated by '|', in the order to place them.
param(
  [Parameter(Mandatory)][ValidateSet('tile', 'stack')][string]$Mode,
  [Parameter(Mandatory)][string]$Names
)

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@

[void][Win]::SetProcessDPIAware()
$SW_RESTORE = 9; $SW_MAXIMIZE = 3
$SWP_NOZORDER = 0x0004; $SWP_NOACTIVATE = 0x0010

# Visible top-level VS Code windows by title: "<editor> - <workspace> - Visual Studio Code".
$titles = @{}
[void][Win]::EnumWindows({
  param($h, $l)
  if ([Win]::IsWindowVisible($h)) {
    $sb = New-Object Text.StringBuilder 1024
    [void][Win]::GetWindowText($h, $sb, 1024)
    $t = $sb.ToString()
    if ($t -match 'Visual Studio Code$') { $titles[$h] = $t }
  }
  $true
}, [IntPtr]::Zero)

$targets = @()
foreach ($name in ($Names -split '\|' | Where-Object { $_ })) {
  $pattern = '(^|\s-\s)' + [regex]::Escape($name) + '\s-\s.*Visual Studio Code$'
  $hit = $titles.Keys | Where-Object { $titles[$_] -match $pattern } | Select-Object -First 1
  if ($hit) { $targets += $hit } else { Write-Output "not found: $name" }
}
if (-not $targets.Count) { exit 0 }

$fg = [Win]::GetForegroundWindow()
$mi = New-Object Win+MONITORINFO
$mi.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($mi)
[void][Win]::GetMonitorInfo([Win]::MonitorFromWindow($fg, 2), [ref]$mi)
$work = $mi.rcWork
$W = $work.Right - $work.Left; $H = $work.Bottom - $work.Top

# Windows 10/11 frames have invisible resize borders, so the outer rect is
# grown by the gap between it and the visible frame to make tiles meet.
function Place($h, $x, $y, $w, $hgt) {
  [void][Win]::ShowWindow($h, $SW_RESTORE)
  [void][Win]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $hgt, $SWP_NOZORDER -bor $SWP_NOACTIVATE)
  $outer = New-Object Win+RECT; $frame = New-Object Win+RECT
  [void][Win]::GetWindowRect($h, [ref]$outer)
  if ([Win]::DwmGetWindowAttribute($h, 9, [ref]$frame, 16) -eq 0) {
    $l = $frame.Left - $outer.Left; $t = $frame.Top - $outer.Top
    $r = $outer.Right - $frame.Right; $b = $outer.Bottom - $frame.Bottom
    [void][Win]::SetWindowPos($h, [IntPtr]::Zero, $x - $l, $y - $t, $w + $l + $r, $hgt + $t + $b, $SWP_NOZORDER -bor $SWP_NOACTIVATE)
  }
}

if ($Mode -eq 'tile') {
  $n = $targets.Count
  $cols = [math]::Ceiling([math]::Sqrt($n)); $rows = [math]::Ceiling($n / $cols)
  for ($i = 0; $i -lt $n; $i++) {
    $c = $i % $cols; $r = [math]::Floor($i / $cols)
    $x = $work.Left + [math]::Floor($W * $c / $cols); $x2 = $work.Left + [math]::Floor($W * ($c + 1) / $cols)
    $y = $work.Top + [math]::Floor($H * $r / $rows); $y2 = $work.Top + [math]::Floor($H * ($r + 1) / $rows)
    Place $targets[$i] $x $y ($x2 - $x) ($y2 - $y)
  }
} else {
  foreach ($h in $targets) {
    Place $h $work.Left $work.Top $W $H
    [void][Win]::ShowWindow($h, $SW_MAXIMIZE)
  }
}
Write-Output "arranged $($targets.Count) window(s): $Mode"
