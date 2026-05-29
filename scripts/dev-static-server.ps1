param(
  [int]$Port = 4197,
  [string]$Root = (Get-Location).Path
)

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
$listener.Start()
Write-Host "Basebound static server listening at http://127.0.0.1:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".png" = "image/png"
  ".svg" = "image/svg+xml"
}

function Write-Response($stream, [int]$status, [string]$contentType, [byte[]]$body) {
  $reason = if ($status -eq 200) { "OK" } elseif ($status -eq 404) { "Not Found" } elseif ($status -eq 403) { "Forbidden" } else { "Error" }
  $headers = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  $stream.Write($body, 0, $body.Length)
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $buffer = New-Object byte[] 4096
      $read = $stream.Read($buffer, 0, $buffer.Length)
      $request = [Text.Encoding]::ASCII.GetString($buffer, 0, $read)
      $firstLine = ($request -split "`r?`n")[0]
      $parts = $firstLine -split " "
      $path = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
      $path = ($path -split "\?")[0]
      $path = [Uri]::UnescapeDataString($path)
      if ($path -eq "/") { $path = "/index.html" }
      $relative = $path.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
      $file = [IO.Path]::GetFullPath([IO.Path]::Combine($Root, $relative))
      $rootFull = [IO.Path]::GetFullPath($Root)
      if (-not $file.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Response $stream 403 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("Forbidden"))
      } elseif (-not [IO.File]::Exists($file)) {
        Write-Response $stream 404 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("Not found"))
      } else {
        $ext = [IO.Path]::GetExtension($file)
        $contentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
        Write-Response $stream 200 $contentType ([IO.File]::ReadAllBytes($file))
      }
    } catch {
      if ($stream) {
        Write-Response $stream 500 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes($_.Exception.Message))
      }
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
