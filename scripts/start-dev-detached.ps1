# start-dev-detached.ps1 — one-shot launcher.
#
# Stops any existing watchdog (so we don't end up with two watchdogs
# fighting over the port), then launches a fresh watchdog in a detached
# PowerShell window. The watchdog keeps the dev server alive and restarts
# it on any death.
#
# After this returns, the user can close the original shell — both
# processes are detached and survive across this session.
#
# Usage (from repo root, in any PowerShell):
#   powershell -NoProfile -File .zscripts\start-dev-detached.ps1
#   tail dev-watchdog.log   # to watch what the watchdog is doing

# Accept -Port so multiple web apps can coexist on the same machine.
# NOTE: `param` MUST be the first statement in PowerShell 5.1.
param(
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

$root = (Split-Path -Parent $PSCommandPath) | Split-Path -Parent
$wd   = Join-Path $root 'scripts\dev-watchdog.ps1'
$wdLog = Join-Path $root 'dev-watchdog.log'

if (-not (Test-Path $wd)) {
  throw "watchdog script not found at $wd"
}

# 1) Stop any existing watchdog (avoid two watchdogs fighting).
$wdProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
           Where-Object {
             $_.Name -match '^(pwsh|powershell)\.exe$' -and
             $_.CommandLine -and
             $_.CommandLine -match 'dev-watchdog\.ps1'
           }
foreach ($p in $wdProcs) {
  Write-Host "stopping existing watchdog PID $($p.ProcessId)"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

# Give the file handles a moment to release so the new watchdog can
# truncate dev.log cleanly.
Start-Sleep -Seconds 2

# 2) Launch the watchdog as a detached process. `Start-Process` with
#    `-WindowStyle Hidden` means it has no parent console and no
#    affiliation with this PowerShell session — no 30-minute bash task
#    ceiling applies.
#
#    NOTE: redirect stdout/stderr to *separate* files, NOT to $wdLog.
#    The watchdog itself appends to $wdLog via .NET's AppendAllText;
#    if the parent process also holds the same file open (for stdout
#    redirection), the watchdog's writes fail with an IOException and
#    the script exits — exactly the failure we saw on first run.
$proc = Start-Process -FilePath 'powershell' `
                      -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File', $wd, '-Port', "$Port" `
                      -WorkingDirectory $root `
                      -RedirectStandardOutput "$wdLog.stdout" `
                      -RedirectStandardError "$wdLog.stderr" `
                      -WindowStyle Hidden `
                      -PassThru
Write-Host "watchdog launched as PID $($proc.Id) on port $Port"
Write-Host "watchdog log:    $wdLog  (use Get-Content -Wait to follow)"
Write-Host "watchdog stdio:  $wdLog.stdout / $wdLog.stderr"
