# 手工构造一个最小可用的两页 PDF，纯用来本地测试阅读器，不依赖任何工具库。
$outPath = "$PSScriptRoot\test.pdf"

function New-PageContentStream {
  param([string[]]$Lines, [int]$StartY = 550, [int]$LineHeight = 30, [int]$FontSize = 16)
  $sb = New-Object System.Text.StringBuilder
  $y = $StartY
  foreach ($line in $Lines) {
    $escaped = $line -replace '\\', '\\\\' -replace '\(', '\(' -replace '\)', '\)'
    [void]$sb.AppendLine("BT /F1 $FontSize Tf 40 $y Td ($escaped) Tj ET")
    $y -= $LineHeight
  }
  return $sb.ToString()
}

$page1Text = New-PageContentStream -Lines @(
  "Hello world, this is a test PDF page one.",
  "The quick brown fox jumps over the lazy dog.",
  "Cargo means goods carried by a ship or vehicle.",
  "Several umbrella words fell across the major road."
)
$page2Text = New-PageContentStream -Lines @(
  "This is the second page of the test book.",
  "Reading English news helps you learn faster.",
  "A dictionary explains the meaning of every word.",
  "Practice makes perfect when learning a language."
)

# 用 Latin1 编码写字节（PDF 语法本身是 ASCII/Latin1 范围）
$enc = [System.Text.Encoding]::GetEncoding("ISO-8859-1")

$objects = @{}
$objects[1] = "1 0 obj`n<< /Type /Catalog /Pages 2 0 R >>`nendobj`n"
$objects[2] = "2 0 obj`n<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>`nendobj`n"
$objects[3] = "3 0 obj`n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 420 650] /Contents 4 0 R >>`nendobj`n"
$objects[4] = "4 0 obj`n<< /Length $($enc.GetByteCount($page1Text)) >>`nstream`n$page1Text`nendstream`nendobj`n"
$objects[5] = "5 0 obj`n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`nendobj`n"
$objects[6] = "6 0 obj`n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 420 650] /Contents 7 0 R >>`nendobj`n"
$objects[7] = "7 0 obj`n<< /Length $($enc.GetByteCount($page2Text)) >>`nstream`n$page2Text`nendstream`nendobj`n"

$header = "%PDF-1.4`n"
$body = New-Object System.Text.StringBuilder
[void]$body.Append($header)
$offsets = @{}
$pos = $enc.GetByteCount($header)
foreach ($i in 1..7) {
  $offsets[$i] = $pos
  [void]$body.Append($objects[$i])
  $pos += $enc.GetByteCount($objects[$i])
}
$xrefStart = $pos

$xref = New-Object System.Text.StringBuilder
[void]$xref.AppendLine("xref")
[void]$xref.AppendLine("0 8")
[void]$xref.AppendLine("0000000000 65535 f ")
foreach ($i in 1..7) {
  [void]$xref.AppendLine("$($offsets[$i].ToString('D10')) 00000 n ")
}
[void]$xref.AppendLine("trailer")
[void]$xref.AppendLine("<< /Size 8 /Root 1 0 R >>")
[void]$xref.AppendLine("startxref")
[void]$xref.AppendLine("$xrefStart")
[void]$xref.Append("%%EOF")

[void]$body.Append($xref.ToString())

[System.IO.File]::WriteAllText($outPath, $body.ToString(), $enc)
Write-Host "Wrote $outPath ($((Get-Item $outPath).Length) bytes)"
