# Builds the isolated demo world for recording: four fake projects, a clean VS Code
# profile with only Window Tracker installed, and a separate tracker state folder.
# Run again any time to reset it.
param([string]$Root = 'C:\DemoTracker', [string]$Vsix)

$ErrorActionPreference = 'Stop'
$code = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'
if (-not $Vsix) { $Vsix = Get-ChildItem (Join-Path $PSScriptRoot '..\window-tracker-*.vsix') | Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName }

foreach ($d in 'vscode\User', 'ext', 'state\sessions', 'state\windows', 'projects') { New-Item -ItemType Directory -Force (Join-Path $Root $d) | Out-Null }
Get-ChildItem (Join-Path $Root 'state') -Recurse -File -ErrorAction SilentlyContinue | Remove-Item -Force

# Clean, readable editor for video: no welcome pages, tips, minimap or trust prompts.
@{
  'workbench.colorTheme'                 = 'Default Dark Modern'
  'workbench.startupEditor'              = 'none'
  'workbench.tips.enabled'               = $false
  'workbench.enableExperiments'          = $false
  'workbench.layoutControl.enabled'      = $false
  'workbench.secondarySideBar.defaultVisibility' = 'hidden'
  'workbench.auxiliaryBar.visible'       = $false
  'window.restoreWindows'                = 'none'
  'window.title'                         = '${rootName} - Visual Studio Code'
  'window.commandCenter'                 = $true
  'security.workspace.trust.enabled'     = $false
  'editor.minimap.enabled'               = $false
  'editor.fontSize'                      = 15
  'editor.lineHeight'                    = 24
  'editor.renderWhitespace'              = 'none'
  'breadcrumbs.enabled'                  = $false
  'extensions.ignoreRecommendations'     = $true
  'update.mode'                          = 'none'
  'telemetry.telemetryLevel'             = 'off'
  'chat.commandCenter.enabled'           = $false
  'chat.disableAIFeatures'               = $true
  'git.enabled'                          = $false
  'files.exclude'                        = @{ '**/.vscode' = $true }
  'vsTracker.focusClaudeInput'           = $false
} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Root 'vscode\User\settings.json')

# Four believable projects with no real client names.
$projects = [ordered]@{
  'Finance Report' = @{
    'README.md'    = "# Finance Report`n`nMonthly finance pack for the leadership team.`n`n- Actuals vs budget by cost centre`n- Rolling 12-month forecast`n- Variance commentary`n"
    'measures.dax' = "Total Actual = SUM ( Actuals[Amount] )`n`nTotal Budget = SUM ( Budget[Amount] )`n`nVariance = [Total Actual] - [Total Budget]`n`nVariance % = DIVIDE ( [Variance], [Total Budget] )`n`nForecast Remaining =`nVAR MonthsLeft = 12 - MAX ( 'Date'[Fiscal Month No] )`nRETURN [Run Rate] * MonthsLeft`n"
    'budget.csv'   = "CostCentre,Month,Budget`nOperations,2026-07,412000`nOperations,2026-08,398500`nMarketing,2026-07,96000`nMarketing,2026-08,101250`nPeople,2026-07,188000`n"
  }
  'Training Video' = @{
    'script.md' = "# Training Video: Self-Service Reporting`n`n## Scene 1`nWelcome. In the next five minutes you'll build your first report.`n`n## Scene 2`nStart by connecting to the shared semantic model.`n`n## Scene 3`nDrag Revenue onto the canvas and slice it by region.`n"
    'render.py' = "`"`"`"Render each scene, mix the voiceover and burn in captions.`"`"`"`nfrom pathlib import Path`n`nSCENES = sorted(Path('scenes').glob('*.mp4'))`n`n`ndef render(scene: Path, lang: str) -> Path:`n    out = Path('out') / f'{scene.stem}_{lang}.mp4'`n    # ffmpeg: scene + voice_{lang}.wav + captions_{lang}.srt`n    return out`n`n`nfor lang in ('en', 'es'):`n    for scene in SCENES:`n        render(scene, lang)`n"
  }
  'HR Analytics' = @{
    'README.md'     = "# HR Analytics`n`nHeadcount, turnover and leave dashboards.`n"
    'headcount.sql' = "SELECT d.FiscalMonth,`n       e.Department,`n       COUNT(DISTINCT e.EmployeeKey) AS Headcount,`n       SUM(CASE WHEN e.TerminationDate IS NOT NULL THEN 1 ELSE 0 END) AS Leavers`nFROM dbo.Employee e`nJOIN dbo.DimDate d ON d.DateKey = e.SnapshotDateKey`nGROUP BY d.FiscalMonth, e.Department`nORDER BY d.FiscalMonth;`n"
  }
  'Client Proposal' = @{
    'proposal.md' = "# Proposal: Data Platform Uplift`n`n## Objectives`n1. One trusted source for finance and people data`n2. Self-service reporting for managers`n3. Monthly pack produced in hours, not days`n`n## Approach`nDiscovery, build, handover. Six weeks.`n"
    'pricing.csv' = "Phase,Weeks,Days`nDiscovery,1,4`nBuild,4,16`nHandover,1,3`n"
  }
}
foreach ($name in $projects.Keys) {
  $dir = Join-Path $Root "projects\$name"
  New-Item -ItemType Directory -Force $dir | Out-Null
  foreach ($f in $projects[$name].Keys) { [IO.File]::WriteAllText((Join-Path $dir $f), $projects[$name][$f]) }
}

# Only Window Tracker in the demo profile. (The CLI writes a Node deprecation warning to
# stderr, which Windows PowerShell would otherwise treat as a terminating error.)
$ErrorActionPreference = 'Continue'
& $code --user-data-dir (Join-Path $Root 'vscode') --extensions-dir (Join-Path $Root 'ext') --install-extension $Vsix --force 2>&1 | Select-String 'success|error' | ForEach-Object { $_.Line }
"Demo world ready at $Root"
