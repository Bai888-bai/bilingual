Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$outPath = "$PSScriptRoot\test.epub"
if (Test-Path $outPath) { Remove-Item $outPath -Force }

$containerXml = @'
<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
'@

$contentOpf = @'
<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Bilingual Book</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:test-book-0001</dc:identifier>
  </metadata>
  <manifest>
    <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chap1"/>
    <itemref idref="chap2"/>
  </spine>
</package>
'@

$tocNcx = @'
<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:test-book-0001"/></head>
  <docTitle><text>Test Bilingual Book</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1"><navLabel><text>Chapter 1</text></navLabel><content src="chapter1.xhtml"/></navPoint>
    <navPoint id="np2" playOrder="2"><navLabel><text>Chapter 2</text></navLabel><content src="chapter2.xhtml"/></navPoint>
  </navMap>
</ncx>
'@

$chapter1 = @'
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>
  <h1>Chapter One: A Beginning</h1>
  <p>Hello world, this is the first chapter of a test book used to check the reader.</p>
  <p>The cargo ship carried several containers of goods across the ocean every major season.</p>
  <p>Reading is a wonderful way to learn a new language, one word at a time.</p>
</body>
</html>
'@

$chapter2 = @'
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body>
  <h1>Chapter Two: The Journey Continues</h1>
  <p>The quick brown fox jumps over the lazy dog near the riverbank.</p>
  <p>A dictionary explains the meaning of every word you might not understand.</p>
  <p>Practice makes perfect when you keep reading every single day.</p>
</body>
</html>
'@

$zip = [System.IO.Compression.ZipFile]::Open($outPath, [System.IO.Compression.ZipArchiveMode]::Create)

# mimetype 必须是第一个条目，且不能压缩
$mimeEntry = $zip.CreateEntry("mimetype", [System.IO.Compression.CompressionLevel]::NoCompression)
$stream = $mimeEntry.Open()
$bytes = [System.Text.Encoding]::ASCII.GetBytes("application/epub+zip")
$stream.Write($bytes, 0, $bytes.Length)
$stream.Close()

function Add-ZipTextEntry {
  param($Zip, [string]$Name, [string]$Content)
  $entry = $Zip.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
  $es = $entry.Open()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Content)
  $es.Write($bytes, 0, $bytes.Length)
  $es.Close()
}

Add-ZipTextEntry -Zip $zip -Name "META-INF/container.xml" -Content $containerXml
Add-ZipTextEntry -Zip $zip -Name "OEBPS/content.opf" -Content $contentOpf
Add-ZipTextEntry -Zip $zip -Name "OEBPS/toc.ncx" -Content $tocNcx
Add-ZipTextEntry -Zip $zip -Name "OEBPS/chapter1.xhtml" -Content $chapter1
Add-ZipTextEntry -Zip $zip -Name "OEBPS/chapter2.xhtml" -Content $chapter2

$zip.Dispose()
Write-Host "Wrote $outPath ($((Get-Item $outPath).Length) bytes)"
