# 极简静态文件服务器，不依赖 Node/Python（这台机器上都没装）。
# 用 .NET 自带的 HttpListener，纯 PowerShell 实现，只用来本地开发调试用。
param(
  [int]$Port = 8787
)

$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
# HttpListener 在非管理员权限下，只有精确匹配 "localhost" / "127.0.0.1" / "[::1]"
# 这几个环回地址才不需要 netsh 提前注册 URL ACL。这里两个都注册上，
# 不管浏览器请求头里的 host 是哪一种写法都能匹配上，避免"服务在跑但连不上"。
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/ (also http://127.0.0.1:$Port/)"

$mimeMap = @{
  ".html"       = "text/html; charset=utf-8"
  ".js"         = "application/javascript; charset=utf-8"
  ".css"        = "text/css; charset=utf-8"
  ".json"       = "application/json; charset=utf-8"
  ".webmanifest"= "application/manifest+json; charset=utf-8"
  ".svg"        = "image/svg+xml"
  ".png"        = "image/png"
  ".pdf"        = "application/pdf"
  ".epub"       = "application/epub+zip"
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $request = $context.Request
  $response = $context.Response
  try {
    $urlPath = [System.Uri]::UnescapeDataString($request.Url.LocalPath)
    if ($urlPath -eq "/") { $urlPath = "/index.html" }
    $filePath = Join-Path $root ($urlPath.TrimStart("/"))

    if (Test-Path $filePath -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
      $contentType = $mimeMap[$ext]
      if (-not $contentType) { $contentType = "application/octet-stream" }
      $response.ContentType = $contentType
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $response.StatusCode = 404
      $notFoundBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
      $response.OutputStream.Write($notFoundBytes, 0, $notFoundBytes.Length)
    }
  } catch {
    try { $response.StatusCode = 500 } catch {}
  } finally {
    # 浏览器提前断开连接时 Close() 会抛异常，这里是本地调试用的服务器，
    # 吞掉就行，不影响后续请求继续处理
    try { $response.OutputStream.Close() } catch {}
  }
}
