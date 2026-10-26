# Lists open documents as JSON on one line:
#   [{ kind, pid, hwnd, path, name, problem }]
# kind is pbi, word, powerpoint or excel. Power BI Desktop runs one process per
# report with the path on its command line; Office apps host every document in
# one process, so those are read through COM. Run under Windows PowerShell 5.1
# (PowerShell 7 has no Marshal.GetActiveObject).
# problem is '' or why the window needs attention: not responding, or (Power BI)
# an error dialog, using the same title rule as the pbi-desktop-doctor skill.
$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class DocWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
  // Visible titled top-level windows: [hwnd, pid, title].
  public static List<object[]> All() {
    var list = new List<object[]>();
    EnumWindows((h, l) => {
      if (IsWindowVisible(h)) {
        var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
        uint p; GetWindowThreadProcessId(h, out p);
        if (sb.Length > 0) list.Add(new object[] { h.ToInt64(), (int)p, sb.ToString() });
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
'@

$windows = [DocWin]::All()
$out = New-Object System.Collections.ArrayList

function Hung($hwnd) { $hwnd -and [DocWin]::IsHungAppWindow([IntPtr][long]$hwnd) }

# A document window found by its title, for when COM gives no handle.
function HwndByTitle($procName, $fileName) {
  $pids = @(Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object Id)
  $stem = [IO.Path]::GetFileNameWithoutExtension($fileName)
  $hit = $windows | Where-Object { $pids -contains $_[1] -and ($_[2].StartsWith($fileName) -or $_[2].StartsWith($stem + ' ')) } | Select-Object -First 1
  if ($hit) { $hit[0] } else { 0 }
}

function Add-Doc($kind, $procName, $path, $hwnd) {
  if (-not $path) { return }
  $name = Split-Path $path -Leaf
  if (-not $hwnd) { $hwnd = HwndByTitle $procName $name }
  $pid_ = 0
  if ($hwnd) { $w = $windows | Where-Object { $_[0] -eq [long]$hwnd } | Select-Object -First 1; if ($w) { $pid_ = $w[1] } }
  [void]$out.Add([ordered]@{ kind = $kind; pid = $pid_; hwnd = [long]$hwnd; path = $path; name = $name; problem = $(if (Hung $hwnd) { 'Not responding' } else { '' }) })
}

# Power BI Desktop
$errorPattern = 'Issues were found|problem|error|couldn|unable|cannot|can.t|warning|failed|not (be )?(found|open)'
foreach ($p in Get-CimInstance Win32_Process -Filter "Name='PBIDesktop.exe'") {
  $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
  if (-not $proc) { continue }
  $file = if ($p.CommandLine -match '"([^"]+\.(pbip|pbix))"') { $Matches[1] } elseif ($p.CommandLine -match '(\S+\.(pbip|pbix))') { $Matches[1] } else { '' }
  if (-not $file) { continue }
  $main = [long]$proc.MainWindowHandle
  $dialogs = @($windows | Where-Object { $_[1] -eq $p.ProcessId -and $_[0] -ne $main } | ForEach-Object { $_[2] })
  $err = @($dialogs | Where-Object { $_ -match $errorPattern }) | Select-Object -First 1
  $problem = if (Hung $main) { 'Not responding' } elseif ($err) { $err } else { '' }
  [void]$out.Add([ordered]@{ kind = 'pbi'; pid = $p.ProcessId; hwnd = $main; path = $file; name = [IO.Path]::GetFileNameWithoutExtension($file); problem = $problem })
}

# Office, only for apps that are running
function App($progId) { try { [Runtime.InteropServices.Marshal]::GetActiveObject($progId) } catch { $null } }
if (Get-Process WINWORD -ErrorAction SilentlyContinue) {
  $word = App 'Word.Application'
  if ($word) {
    try { foreach ($d in $word.Documents) { Add-Doc 'word' 'WINWORD' $d.FullName $(try { $d.ActiveWindow.Hwnd } catch { 0 }) } } catch {}
    try { foreach ($v in $word.ProtectedViewWindows) { Add-Doc 'word' 'WINWORD' $v.Document.FullName 0 } } catch {}
  }
}
if (Get-Process POWERPNT -ErrorAction SilentlyContinue) {
  $ppt = App 'PowerPoint.Application'
  if ($ppt) {
    try { foreach ($d in $ppt.Presentations) { Add-Doc 'powerpoint' 'POWERPNT' $d.FullName $(try { $d.Windows.Item(1).HWND } catch { 0 }) } } catch {}
    try { foreach ($v in $ppt.ProtectedViewWindows) { Add-Doc 'powerpoint' 'POWERPNT' $v.Presentation.FullName 0 } } catch {}
  }
}
if (Get-Process EXCEL -ErrorAction SilentlyContinue) {
  $xl = App 'Excel.Application'
  if ($xl) {
    try { foreach ($d in $xl.Workbooks) { Add-Doc 'excel' 'EXCEL' $d.FullName $(try { $d.Windows.Item(1).Hwnd } catch { 0 }) } } catch {}
    try { foreach ($v in $xl.ProtectedViewWindows) { Add-Doc 'excel' 'EXCEL' $v.Workbook.FullName 0 } } catch {}
  }
}

ConvertTo-Json -InputObject @($out) -Compress -Depth 4
