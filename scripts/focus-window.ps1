# Brings a window (by -Hwnd, or a process's main window by -ProcessId) to the
# front. Windows only lets the foreground app hand over focus, so this briefly
# attaches to the foreground window's input thread (and taps Alt) before
# restoring and raising the target.
param([int]$ProcessId, [long]$Hwnd)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FocusWin {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static bool Raise(IntPtr h) {
    uint me = GetCurrentThreadId();
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    uint target = GetWindowThreadProcessId(h, IntPtr.Zero);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);   // Alt down
    keybd_event(0x12, 0, 2, UIntPtr.Zero);   // Alt up
    AttachThreadInput(me, fg, true);
    AttachThreadInput(target, fg, true);
    ShowWindow(h, IsIconic(h) ? 9 : 5);      // SW_RESTORE : SW_SHOW
    BringWindowToTop(h);
    bool ok = SetForegroundWindow(h);
    AttachThreadInput(target, fg, false);
    AttachThreadInput(me, fg, false);
    return ok && GetForegroundWindow() == h;
  }
}
'@

$h = if ($Hwnd) { [IntPtr]$Hwnd } else { (Get-Process -Id $ProcessId -ErrorAction Stop).MainWindowHandle }
if ($h -eq [IntPtr]::Zero) { Write-Output 'no window'; exit 1 }
Write-Output "focused=$([FocusWin]::Raise($h))"
