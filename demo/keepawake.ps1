# Keeps the PC and displays awake (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
# until this process is stopped. Used while recording and rendering the demo video.
$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
$k = Add-Type -Name KA -Namespace W -PassThru -MemberDefinition $sig
while ($true) { [void]$k::SetThreadExecutionState([uint32]"0x80000003"); Start-Sleep 50 }
