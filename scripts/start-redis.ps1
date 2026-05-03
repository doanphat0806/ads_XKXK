$redisDir = Join-Path $PSScriptRoot '..\tools\redis'
$redisServer = Join-Path $redisDir 'redis-server.exe'
$redisCli = Join-Path $redisDir 'redis-cli.exe'
$redisConfig = Join-Path $redisDir 'redis.windows.conf'
$redisLog = Join-Path $redisDir 'redis-server.log'

if (-not (Test-Path $redisServer)) {
  Write-Error "Redis portable not found at $redisServer"
  exit 1
}

$existing = Get-NetTCPConnection -LocalPort 6379 -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq 'Listen' } |
  Select-Object -First 1

if (-not $existing) {
  Set-Location $redisDir
  if (Test-Path $redisConfig) {
    & $redisServer $redisConfig --port 6379
  } else {
    & $redisServer --port 6379
  }
  exit $LASTEXITCODE
}

if (Test-Path $redisCli) {
  & $redisCli -h 127.0.0.1 -p 6379 ping
}
