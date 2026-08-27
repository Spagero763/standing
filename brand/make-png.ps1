# Renders the mark to PNG at whatever size a submission form asks for.
# Mirrors brand/logo-mark.svg exactly: three narrowing bars, a diamond above.

param(
  [int]$Size = 480,
  [string]$Out = "$PSScriptRoot\logo-480.png",
  [string]$Background = '#0B0B10'
)

Add-Type -AssemblyName System.Drawing

$scale = $Size / 64.0
$teal = @(45, 212, 191)

function New-RoundedPath([double]$x, [double]$y, [double]$w, [double]$h, [double]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$bmp = New-Object System.Drawing.Bitmap($Size, $Size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$bg = [System.Drawing.ColorTranslator]::FromHtml($Background)
$g.Clear($bg)

# The three bars, widest and faintest at the base.
$bars = @(
  @{ x = 6;  y = 44; w = 52; h = 7; a = 0.32 },
  @{ x = 15; y = 32; w = 34; h = 7; a = 0.58 },
  @{ x = 24; y = 20; w = 16; h = 7; a = 0.84 }
)

foreach ($b in $bars) {
  $alpha = [int][Math]::Round($b.a * 255)
  $colour = [System.Drawing.Color]::FromArgb($alpha, $teal[0], $teal[1], $teal[2])
  $brush = New-Object System.Drawing.SolidBrush($colour)
  $path = New-RoundedPath ($b.x * $scale) ($b.y * $scale) ($b.w * $scale) ($b.h * $scale) (3.5 * $scale)
  $g.FillPath($brush, $path)
  $path.Dispose(); $brush.Dispose()
}

# The diamond: a rounded square rotated 45 degrees about its own centre.
$state = $g.Save()
$g.TranslateTransform(32 * $scale, 10 * $scale)
$g.RotateTransform(45)
$side = 10 * $scale
$solid = New-Object System.Drawing.SolidBrush(
  [System.Drawing.Color]::FromArgb(255, $teal[0], $teal[1], $teal[2])
)
$diamond = New-RoundedPath (-$side / 2) (-$side / 2) $side $side (2 * $scale)
$g.FillPath($solid, $diamond)
$diamond.Dispose(); $solid.Dispose()
$g.Restore($state)

$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$info = Get-Item $Out
Write-Output "wrote $($info.FullName)"
Write-Output "  $Size x $Size, $([Math]::Round($info.Length / 1KB, 1)) KB"
