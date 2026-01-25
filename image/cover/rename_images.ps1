$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

$extensions = @("*.jpg", "*.jpeg", "*.png", "*.gif", "*.bmp", "*.webp", "*.heif")

$allImages = @()
foreach ($ext in $extensions) {
    $allImages += Get-ChildItem -Path $scriptPath -Filter $ext -File 2>$null
}

$maxNum = 0
foreach ($file in $allImages) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    if ($baseName -match "^\d+$") {
        try {
            $num = [long]$baseName
            if ($num -gt $maxNum -and $num -lt 1000000) {
                $maxNum = $num
            }
        } catch {}
    }
}

Write-Host "Max number: $maxNum"

$nextNum = $maxNum + 1
$renamedCount = 0

foreach ($file in $allImages) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $extension = $file.Extension

    $isSimpleNumber = ($baseName -match "^\d+$") -and ($baseName.Length -le 6)

    if (-not $isSimpleNumber -and $file.Name -notlike "*.ps1" -and $file.Name -notlike "*.bat") {
        while (Test-Path (Join-Path $scriptPath "$nextNum$extension")) {
            $nextNum++
        }

        $newName = "$nextNum$extension"
        Write-Host "Rename: $($file.Name) -> $newName"

        try {
            Rename-Item -Path $file.FullName -NewName $newName -ErrorAction Stop
            $renamedCount++
            $nextNum++
        } catch {
            Write-Host "Error: $_"
        }
    }
}

Write-Host "Done! Renamed $renamedCount files"
Read-Host "Press Enter to exit"
