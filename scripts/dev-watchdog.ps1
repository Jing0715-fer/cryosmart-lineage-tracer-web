# dev-watchdog.ps1 — long-running process supervisor for `bun next dev`.
#
# Behaviour
#   - Every 30s, check whether port 3000 is listening.
#   - If not, start a fresh `bun next dev -p 3000` via Start-Process so the
#     child is detached from this script and survives this script's death.
#   - Append every action to dev-watchdog.log so a manual `tail` shows the
#     last restart timestamp.
#
# Why a separate watchdog?
#   The original `bun next dev` was launched via `run_in_background: true`
#   (a bash task with a 30-minute hard limit). After ~30min the task got
#   SIGKILL'd, taking the `next dev` child with it. Switching to
#   `Start-Process` made the dev server detached from any bash task tree, so
#   the 30min ceiling no longer applies — but the dev server can still die
#   for other reasons (OOM, OS kill, manual stop, machine sleep). This
#   watchdog adds the missing piece: if the dev server dies for ANY reason,
#   it comes back within 30s without user intervention.
#
# Usage (from repo root, in any PowerShell):
#   powershell -NoProfile -File .zscripts\dev-watchdog.ps1
#   (or use .zscripts\start-dev-detached.ps1 to launch it without keeping
#    the parent shell open)

# Accept -Port so multiple web apps can coexist on the same machine (the
# default 3000 may be claimed by another project).
# NOTE: `param` MUST be the first statement in PowerShell 5.1 — the
# previous version put it after $ErrorActionPreference, which pwsh
# tolerates but Windows PowerShell 5.1 rejects with "param is not a
# recognized cmdlet". Keep this block at the very top.
param(
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

# Resolve repo root from this script's location so it works regardless of
# the current working directory the user happened to launch us from.
$root    = (Split-Path -Parent $PSCommandPath) | Split-Path -Parent
$log     = Join-Path $root 'dev.log'
$logErr  = Join-Path $root 'dev.err.log'
$wdLog   = Join-Path $root 'dev-watchdog.log'
$checkEverySec    = 30
$startupGraceSec  = 20   # how long to wait after starting before re-checking

# UTF-8 *without* BOM — PowerShell 5.1's `Add-Content` defaults to ANSI on
# non-English Windows and would mangle the timestamp + any non-ASCII text.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  [System.IO.File]::AppendAllText($wdLog, $line + [Environment]::NewLine, $utf8NoBom)
}

function IsListening {
  try {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    return $null -ne $conn
  } catch {
    return $false
  }
}

function StartDev {
  Log "port $port not listening, starting bun next dev"
  $proc = Start-Process -FilePath 'bun' `
                        -ArgumentList 'next','dev','-p',"$port" `
                        -WorkingDirectory $root `
                        -RedirectStandardOutput $log `
                        -RedirectStandardError $logErr `
                        -WindowStyle Hidden `
                        -PassThru
  Log ("started bun as PID {0}; giving it {1}s to bind port {2}" -f $proc.Id, $startupGraceSec, $port)
  Start-Sleep -Seconds $startupGraceSec
}

Log ("watchdog started (PID={0}, root={1}, port={2})" -f $PID, $root, $port)

# Adopt an already-running dev server; only start one if the port is dead.
if (-not (IsListening)) {
  StartDev
} else {
  Log "port $port already listening, adopting existing dev server"
}

# Main loop. Catch any unhandled exception so the loop never dies; instead
# log and keep going — the next 30s tick is the recovery.
while ($true) {
  Start-Sleep -Seconds $checkEverySec
  try {
    if (-not (IsListening)) {
      StartDev
    }
  } catch {
    Log ("loop error (continuing): {0}" -f $_.Exception.Message)
  }
}
