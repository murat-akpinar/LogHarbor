# Fills a running LogHarbor with demo events: logs in, creates its own API key, then
# posts CLEF spread over the last N days so the dashboard/analysis views have shape.
#   .\scripts\seed-demo.ps1 -Password logharbor-test-1234
param(
    [string]$BaseUrl = 'http://localhost:5000',
    [string]$Username = 'admin',
    [Parameter(Mandatory = $true)][string]$Password,
    [int]$Days = 7,
    [int]$Count = 3000
)

$ErrorActionPreference = 'Stop'

# -SessionVariable on the first call is what creates the cookie jar we reuse below
$status = Invoke-RestMethod "$BaseUrl/api/auth/status" -SessionVariable session
if ($status.authRequired) {
    $login = Invoke-WebRequest -UseBasicParsing -Method Post "$BaseUrl/api/auth/login" `
        -ContentType 'application/json' `
        -Body (@{ username = $Username; password = $Password } | ConvertTo-Json)
    # the session cookie is Secure (production default), so .NET's cookie jar refuses to
    # replay it over plain http; browsers exempt localhost and we mirror that exemption here
    $pair = (@($login.Headers['Set-Cookie'])[0] -split ';')[0]
    $name, $value = $pair -split '=', 2
    $session.Cookies.Add([System.Net.Cookie]::new($name, $value, '/', ([uri]$BaseUrl).Host))
}
$key = Invoke-RestMethod -Method Post "$BaseUrl/api/apikeys" -ContentType 'application/json' `
    -Body (@{ title = "demo-seed $(Get-Date -Format s)" } | ConvertTo-Json) -WebSession $session

# weighted so the mix looks like a real service: mostly Information, few Error, rare Fatal
$levels = @('Information') * 60 + @('Debug') * 15 + @('Warning') * 15 + @('Error') * 9 + @('Fatal')
$paths = '/api/orders', '/api/orders/{id}', '/api/users', '/healthz', '/api/reports/daily'
$exceptions = @(
    "System.InvalidOperationException: Order is already shipped`n   at Api.Orders.Ship()",
    "System.TimeoutException: The operation timed out`n   at Api.Db.Query()",
    "Npgsql.PostgresException: 23505: duplicate key value`n   at Api.Db.Insert()"
)

$now = [DateTimeOffset]::UtcNow
$lines = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $Count; $i++) {
    # business hours get ~4x the traffic, so the heatmap shows a diurnal band
    $hour = if ((Get-Random -Maximum 100) -lt 75) { Get-Random -Minimum 8 -Maximum 19 } else { Get-Random -Maximum 24 }
    $timestamp = $now.AddDays(-(Get-Random -Maximum $Days)).Date.AddHours($hour).
        AddMinutes((Get-Random -Maximum 60)).AddSeconds((Get-Random -Maximum 60))
    # today's later hours are still in the future; LogHarbor clamps anything more than 5 minutes
    # ahead to ingest time (ClefParser), which would pile them all into one heatmap cell
    if ($timestamp -gt $now) { $timestamp = $timestamp.AddDays(-$Days) }
    $level = $levels | Get-Random

    $event = [ordered]@{
        '@t' = $timestamp.ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
        '@l' = $level
    }
    switch ($level) {
        { $_ -in 'Error', 'Fatal' } {
            $event['@mt'] = 'Order {OrderId} failed for {UserId}'
            $event['@x'] = $exceptions | Get-Random
            $event['OrderId'] = Get-Random -Minimum 1000 -Maximum 1100
            $event['UserId'] = "user-$(Get-Random -Maximum 50)"
            # nested value: exercises the collapsible property tree in EventDetail
            $event['Cart'] = @{ Total = [math]::Round((Get-Random -Minimum 5.0 -Maximum 500.0), 2); Items = @('sku-1', 'sku-7') }
        }
        'Warning' {
            $event['@mt'] = 'Slow request {Path} took {DurationMs} ms'
            $event['Path'] = $paths | Get-Random
            $event['DurationMs'] = Get-Random -Minimum 800 -Maximum 5000
        }
        default {
            $event['@mt'] = 'Handled {Path} in {DurationMs} ms'
            $event['Path'] = $paths | Get-Random
            $event['DurationMs'] = Get-Random -Minimum 3 -Maximum 400
            $event['UserId'] = "user-$(Get-Random -Maximum 50)"
        }
    }
    $lines.Add(($event | ConvertTo-Json -Compress -Depth 5))
}

# batched to stay under MaxBatchBytes (5 MB default)
$batchSize = 500
for ($offset = 0; $offset -lt $lines.Count; $offset += $batchSize) {
    $batch = $lines[$offset..([Math]::Min($offset + $batchSize, $lines.Count) - 1)] -join "`n"
    Invoke-RestMethod -Method Post "$BaseUrl/api/events/raw" `
        -Headers @{ 'X-LogHarbor-ApiKey' = $key.token } `
        -ContentType 'application/vnd.serilog.clef' -Body $batch | Out-Null
    Write-Host "sent $([Math]::Min($offset + $batchSize, $lines.Count)) / $($lines.Count)"
}

$health = Invoke-RestMethod "$BaseUrl/healthz"
Write-Host "done. eventCount = $($health.eventCount)"
