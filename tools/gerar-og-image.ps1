# Gera src/assets/og-image.png (1200x630): imagem de previa ao compartilhar o link (WhatsApp, redes).
# Uso (Windows PowerShell):  powershell -ExecutionPolicy Bypass -File tools\gerar-og-image.ps1
# Textos com acento usam entidades HTML para nao depender da codificacao deste arquivo.
Add-Type -AssemblyName System.Drawing
$dec = { param($s) [System.Net.WebUtility]::HtmlDecode($s) }

$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'src\assets\og-image.png'
$W = 1200; $H = 630
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.InterpolationMode = 'HighQualityBicubic'

function C($hex, $a = 255) { $c = [System.Drawing.ColorTranslator]::FromHtml($hex); [System.Drawing.Color]::FromArgb($a, $c.R, $c.G, $c.B) }
function RoundRect($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}

# fundo
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, (C '#0b1020'), (C '#1a2552'), 30
$g.FillRectangle($bg, $rect)
# brilhos suaves
$glow1 = New-Object System.Drawing.SolidBrush (C '#3b6cff' 40)
$glow2 = New-Object System.Drawing.SolidBrush (C '#f59e0b' 18)
$g.FillEllipse($glow1, -220, -260, 700, 700)
$g.FillEllipse($glow2, 760, 330, 640, 640)

# faixa de cores no topo
$g.FillRectangle((New-Object System.Drawing.SolidBrush (C '#3b6cff')), 0, 0, 400, 10)
$g.FillRectangle((New-Object System.Drawing.SolidBrush (C '#f59e0b')), 400, 0, 400, 10)
$g.FillRectangle((New-Object System.Drawing.SolidBrush (C '#10b981')), 800, 0, 400, 10)

$white = New-Object System.Drawing.SolidBrush (C '#ffffff')
$soft = New-Object System.Drawing.SolidBrush (C '#c7d0ea')
$mute = New-Object System.Drawing.SolidBrush (C '#8d99bf')

$fLabel = New-Object System.Drawing.Font 'Segoe UI Semibold', 22, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fTitle = New-Object System.Drawing.Font 'Segoe UI', 104, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fSub = New-Object System.Drawing.Font 'Segoe UI', 36, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$fSmall = New-Object System.Drawing.Font 'Segoe UI Semibold', 24, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)

$g.DrawString((& $dec 'ELEI&Ccedil;&Otilde;ES 2026 &middot; MARANH&Atilde;O'), $fLabel, $mute, 70, 70)
$g.DrawString('Dashboard MA', $fTitle, $white, 62, 112)
$g.DrawString((& $dec 'Governador, presidente, senador e deputados'), $fSub, $soft, 70, 252)
$g.DrawString((& $dec 'por munic&iacute;pio, zona e se&ccedil;&atilde;o'), $fSub, $soft, 70, 300)

# barra do resultado de governador (1o turno)
$bx = 70; $by = 430; $bw = 1060; $bh = 46
$parts = @(
  @{ n = 'Eduardo Braide'; p = 54.02; c = '#3b6cff' },
  @{ n = 'Orleans Brand&atilde;o'; p = 34.76; c = '#f59e0b' },
  @{ n = 'Felipe Camar&atilde;o'; p = 9.60; c = '#10b981' },
  @{ n = ''; p = 1.62; c = '#475569' }
)
$clip = RoundRect $bx $by $bw $bh 23
$g.SetClip($clip)
$x = [double]$bx
foreach ($s in $parts) {
  $w = $bw * $s.p / 100
  $g.FillRectangle((New-Object System.Drawing.SolidBrush (C $s.c)), [single]$x, $by, [single]($w + 1), $bh)
  $x += $w
}
$g.ResetClip()

# legenda em linha, abaixo da barra
$lx = 70
foreach ($s in $parts) {
  if ($s.n -ne '') {
    $txt = (& $dec $s.n) + '  ' + ('{0:N2}%' -f $s.p).Replace('.', ',')
    $g.FillEllipse((New-Object System.Drawing.SolidBrush (C $s.c)), [single]$lx, $by + $bh + 24, 16, 16)
    $g.DrawString($txt, $fSmall, $white, [single]($lx + 26), $by + $bh + 14)
    $lx += 380
  }
}
$g.DrawString((& $dec 'Governador &middot; 1&ordm; turno &middot; % dos votos v&aacute;lidos (TSE)'), $fLabel, $mute, 70, 560)

$g.Dispose()
New-Item -ItemType Directory -Force -Path (Split-Path $out -Parent) | Out-Null
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "gerado: $out"
