$f = 'c:\Users\cjaramilloj\OneDrive - Gaseosas Postobon S.A\Cristian\DLLO Importaciones Jarapo\src\views\sales.js'
$lines = [System.IO.File]::ReadAllLines($f)
$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Length; $i++) {
    $n = $i + 1
    if ($n -ge 714 -and $n -le 735) { continue }
    $out.Add($lines[$i])
}
[System.IO.File]::WriteAllLines($f, $out, [System.Text.Encoding]::UTF8)
Write-Host "Done. Total lines: $($out.Count)"
