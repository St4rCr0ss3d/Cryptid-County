[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('Start', 'Stop', 'Status')]
    [string]$Action = 'Start',

    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$runDirectory = Join-Path $PSScriptRoot '.cryptid-server'
$statePath = Join-Path $runDirectory 'process.json'
$stdoutPath = Join-Path $runDirectory 'server.log'
$stderrPath = Join-Path $runDirectory 'server-error.log'

function Get-GameProcess {
    if (!(Test-Path -LiteralPath $statePath)) {
        return
    }

    $record = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $server = Get-Process -Id $record.ProcessId -ErrorAction SilentlyContinue
    if ($server -and !$server.HasExited -and $server.ProcessName -eq 'node' -and
        [string]$server.StartTime.ToUniversalTime().Ticks -eq $record.StartTime) {
        return $server
    }

    Remove-Item -LiteralPath $statePath
}

function Get-GameAddresses {
    Get-Content -LiteralPath $stdoutPath -Encoding UTF8 -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '^Cryptid County .+ (This computer|Same network): http://' }
}

function Stop-GameProcess($Server) {
    if (!$Server.HasExited) {
        $Server.Kill()
        if (!$Server.WaitForExit(5000)) {
            throw 'The game server is taking too long to stop.'
        }
    }
}

function Start-GameProcess([string]$NodePath, [string]$Port) {
    $previousPort = $env:PORT
    try {
        $env:PORT = $Port
        $server = Start-Process -FilePath $NodePath -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot `
            -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    } finally {
        $env:PORT = $previousPort
    }

    $ready = $false
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        while (!$server.HasExited -and [DateTime]::UtcNow -lt $deadline) {
            if (@(Get-GameAddresses).Count) {
                @{
                    ProcessId = $server.Id
                    StartTime = [string]$server.StartTime.ToUniversalTime().Ticks
                } | ConvertTo-Json | Set-Content -LiteralPath $statePath
                $ready = $true
                return $server
            }
            Start-Sleep -Milliseconds 150
        }

        if ($server.HasExited) {
            $server.WaitForExit()
            $failure = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
            if ($failure -match 'EADDRINUSE') { return }
        }
        throw "Cryptid County did not start. See the error log at $stderrPath"
    } finally {
        if (!$ready) {
            Stop-GameProcess $server
            if (Test-Path -LiteralPath $statePath) {
                Remove-Item -LiteralPath $statePath
            }
        }
    }
}

[void][System.IO.Directory]::CreateDirectory($runDirectory)
$lockPath = Join-Path $runDirectory 'launcher.lock'
try {
    $lock = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
} catch [System.IO.IOException] {
    throw 'Another game launcher command is running. Try again when it finishes.'
}

try {
    $server = Get-GameProcess
    if ($Action -eq 'Stop') {
        if ($server) {
            Stop-GameProcess $server
            Remove-Item -LiteralPath $statePath
            Write-Host 'Cryptid County stopped. Any active matches have ended.'
        } else {
            Write-Host 'No launcher-managed server is running.'
        }
        return
    }

    if (!$server -and $Action -eq 'Status') {
        Write-Host 'No launcher-managed server is running.'
        return
    }

    if (!$server) {
        $node = Get-Command node.exe -CommandType Application | Select-Object -First 1
        $port = if ([string]::IsNullOrWhiteSpace($env:PORT)) { '3000' } else { $env:PORT }
        $server = Start-GameProcess $node.Source $port
        if (!$server -and $port -ne '0') {
            Write-Host "Port $port is already in use. Starting on an available port."
            # Port 0 lets Windows assign a free port when the server binds.
            $server = Start-GameProcess $node.Source '0'
        }
        if (!$server) {
            throw "Cryptid County could not bind to an available port. See the error log at $stderrPath"
        }
    }

    $addresses = @(Get-GameAddresses)
    $addresses | ForEach-Object { Write-Host $_ }
    if ($Action -eq 'Start' -and !$NoBrowser -and $addresses[0] -match 'This computer: (http://\S+)') {
        Start-Process $Matches[1]
    }
} finally {
    $lock.Dispose()
}
