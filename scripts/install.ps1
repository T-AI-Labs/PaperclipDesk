# Builds the release binary and copies it, with the bundled Paperclip server and its Node.js runtime,
# to %LOCALAPPDATA%\PaperclipDesk (target\release stays free for rebuilds).
# Usage from the repository root:  .\scripts\install.ps1   (Windows PowerShell 5.1 or later)
param(
    [string]$Destination = (Join-Path $env:LOCALAPPDATA 'PaperclipDesk'),
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'target\release\paperclipdesk.exe'
$server = Join-Path $root 'build\server-bundle\win-x64\server'
$node = Join-Path $root 'build\node-bin\win-x64\node.exe'

$running = Get-Process paperclipdesk -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($Destination, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
    throw "PaperclipDesk läuft noch aus $Destination. Bitte zuerst beenden."
}

if (-not $SkipBuild) {
    Push-Location $root
    try {
        if (-not (Test-Path (Join-Path $server 'dist\index.js')) -or -not (Test-Path $node)) {
            npm run prepare-server
            if ($LASTEXITCODE -ne 0) { throw 'prepare-server fehlgeschlagen' }
        }
        if (-not (Test-Path (Join-Path $server 'ui-dist\index.html'))) {
            npm run prepare-server-ui
            if ($LASTEXITCODE -ne 0) { throw 'prepare-server-ui fehlgeschlagen' }
        }
        # A cached UI build once kept an outdated command permission list (ACL), so new UI commands were refused.
        cargo clean --release -p paperclipdesk
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'tauri build fehlgeschlagen' }
    } finally {
        Pop-Location
    }
}

$appServer = Join-Path $Destination 'app-server'
New-Item -ItemType Directory -Force -Path (Join-Path $appServer 'node-bin') | Out-Null
Copy-Item -Path $exe -Destination $Destination -Force
Copy-Item -Path $node -Destination (Join-Path $appServer 'node-bin') -Force
Copy-Item -Path (Join-Path (Split-Path -Parent $node) 'LICENSE') -Destination (Join-Path $appServer 'node-bin') -Force
Copy-Item -Path (Join-Path $root 'THIRD_PARTY_LICENSES.txt') -Destination $Destination -Force
# /MIR, so nothing of an older server version stays behind; robocopy reports success with exit codes below 8.
robocopy $server (Join-Path $appServer 'server') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Kopieren des Servers fehlgeschlagen (robocopy $LASTEXITCODE)" }

$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\ProgramsgentDesk.lnk'))
$shortcut.TargetPath = Join-Path $Destination 'paperclipdesk.exe'
$shortcut.WorkingDirectory = $Destination
$shortcut.Save()

Write-Host "Installiert nach $Destination"
Write-Host 'Starten: Startmenü → „PaperclipDesk“'
