# rule 15 clipboard extraction: DeviceIndependentBitmap -> png at temp path
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$out = 'C:\tmp\pasted-image.png'
if (-not (Test-Path 'C:\tmp')) { New-Item -ItemType Directory -Path 'C:\tmp' -Force | Out-Null }

$d = [System.Windows.Forms.Clipboard]::GetDataObject()
if (-not $d) { throw 'clipboard empty/unavailable' }
$formats = $d.GetFormats()
Write-Host ("formats: " + ($formats -join ', '))

# 1. Clipboard.GetImage() (handles DIB / DeviceIndependentBitmap natively)
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
    $img.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
} else {
    # 2. explicit encoded formats as secondary attempt
    $done = $false
    foreach ($fmt in @('PNG', 'image/png', 'image/jpeg', 'image/bmp')) {
        if ($formats -contains $fmt) {
            $data = $d.GetData($fmt)
            try {
                if ($data -is [System.IO.Stream]) {
                    $ms = New-Object System.IO.MemoryStream
                    $data.Position = 0
                    $data.CopyTo($ms)
                    [System.IO.File]::WriteAllBytes($out, $ms.ToArray())
                } elseif ($data -is [byte[]]) {
                    [System.IO.File]::WriteAllBytes($out, $data)
                } else { continue }
                if ((Get-Item $out).Length -gt 0) { $done = $true; break }
            } catch { continue }
        }
    }
    if (-not $done) { throw ('DeviceIndependentBitmap/GetImage extraction failed; formats: ' + ($formats -join ', ')) }
}

if (-not (Test-Path $out)) { throw 'extraction produced no file' }
$f = Get-Item $out
Write-Host ("saved: " + $f.FullName + " (" + $f.Length + " bytes)")