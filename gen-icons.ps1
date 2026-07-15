Add-Type -AssemblyName System.Drawing

function New-Icon {
  param([int]$Size, [string]$OutPath)
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

  # 圆角矩形背景，跟扩展/生词本页面用的同一个蓝色主色调
  $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
  $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 79, 107, 255))
  $radius = [int]($Size * 0.22)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($Size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $Size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($bgBrush, $path)

  # 中间画一个简单的"书"图形：白色书页 + 中间一条线
  $fg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $bw = [int]($Size * 0.5)
  $bh = [int]($Size * 0.38)
  $bx = ($Size - $bw) / 2
  $by = ($Size - $bh) / 2
  $bookRect = New-Object System.Drawing.Rectangle $bx, $by, $bw, $bh
  $bookPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $br = [int]($Size * 0.03)
  $bd = $br * 2
  $bookPath.AddArc($bx, $by, $bd, $bd, 180, 90)
  $bookPath.AddArc($bx + $bw - $bd, $by, $bd, $bd, 270, 90)
  $bookPath.AddArc($bx + $bw - $bd, $by + $bh - $bd, $bd, $bd, 0, 90)
  $bookPath.AddArc($bx, $by + $bh - $bd, $bd, $bd, 90, 90)
  $bookPath.CloseFigure()
  $g.FillPath($fg, $bookPath)

  $linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 79, 107, 255)), ([float]($Size * 0.02))
  $g.DrawLine($linePen, $Size / 2, $by + $Size * 0.04, $Size / 2, $by + $bh - $Size * 0.04)

  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

New-Icon -Size 192 -OutPath "$PSScriptRoot\icons\icon-192.png"
New-Icon -Size 512 -OutPath "$PSScriptRoot\icons\icon-512.png"
New-Icon -Size 180 -OutPath "$PSScriptRoot\icons\apple-touch-icon.png"
Write-Host "Icons generated."
