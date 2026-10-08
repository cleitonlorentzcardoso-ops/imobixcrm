$ErrorActionPreference = 'Stop'

$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$desktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$loginUrl = 'http://localhost:3000/login'

function Test-LocalPort([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $attempt = $client.ConnectAsync('127.0.0.1', $port)
        return $attempt.Wait(1000) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-DockerReady {
    try {
        & $docker info --format '{{.ServerVersion}}' *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath $docker)) {
    throw 'Docker Desktop não encontrado. Consulte o arquivo ACESSO-LOCAL.md.'
}

if (-not (Test-DockerReady)) {
    Write-Host 'Iniciando o Docker Desktop...'
    Start-Process -FilePath $desktop -WindowStyle Hidden
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        if (Test-DockerReady) { $ready = $true; break }
    }
    if (-not $ready) { throw 'Docker Desktop não ficou pronto após dois minutos.' }
}

if (-not (Test-LocalPort 54321)) {
    Write-Host 'Iniciando o banco local...'
    $startDatabase = 'cd /root/DeskcommCRM && export DOCKER_HOST=unix:///mnt/wsl/docker-desktop/shared-sockets/guest-services/docker.proxy.sock && bash scripts/local-supabase.sh start'
    & wsl.exe -d Ubuntu-22.04 --user root -- bash -lc $startDatabase
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível iniciar o banco local.' }
}

if (-not (Test-LocalPort 3000)) {
    Write-Host 'Iniciando o aplicativo local...'
    $startApp = 'cd /root/DeskcommCRM && setsid -f sh -c ''NODE_ENV=development NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=2048 pnpm dev --hostname 127.0.0.1 > .local-dev.log 2>&1 < /dev/null'''
    $ready = $false
    for ($attempt = 1; $attempt -le 2 -and -not $ready; $attempt++) {
        & wsl.exe -d Ubuntu-22.04 --user root -- bash -lc $startApp
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível iniciar o aplicativo local.' }
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 2
            if (Test-LocalPort 3000) { $ready = $true; break }
        }
    }
    if (-not $ready) { throw 'O aplicativo não abriu a porta 3000. Verifique /root/DeskcommCRM/.local-dev.log no WSL.' }
}

Write-Host "CRM disponível em $loginUrl"
Start-Process $loginUrl
