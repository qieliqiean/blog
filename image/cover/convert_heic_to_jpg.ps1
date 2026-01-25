param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input not found: $InputPath"
}

$outDir = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapEncoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
} | Select-Object -First 1

$asTaskAction = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and (-not $_.IsGenericMethod) -and $_.GetParameters().Count -eq 1
} | Select-Object -First 1

function AwaitOperation([object]$asyncOp, [type]$resultType) {
  $method = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $method.Invoke($null, @($asyncOp))
  return $task.GetAwaiter().GetResult()
}

function AwaitAction([object]$asyncAction) {
  $task = $asTaskAction.Invoke($null, @($asyncAction))
  $task.GetAwaiter().GetResult() | Out-Null
}

try {
  $inputFileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($InputPath)
  $inputFile = AwaitOperation $inputFileOp ([Windows.Storage.StorageFile])

  $inputStreamOp = $inputFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)
  $inputStream = AwaitOperation $inputStreamOp ([Windows.Storage.Streams.IRandomAccessStream])

  $decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($inputStream)
  $decoder = AwaitOperation $decoderOp ([Windows.Graphics.Imaging.BitmapDecoder])

  $bitmapOp = $decoder.GetSoftwareBitmapAsync()
  $bitmap = AwaitOperation $bitmapOp ([Windows.Graphics.Imaging.SoftwareBitmap])
  if ($bitmap.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8 -or $bitmap.BitmapAlphaMode -ne [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied) {
    $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)
  }

  $folderPath = Split-Path -Parent $OutputPath
  $fileName = Split-Path -Leaf $OutputPath

  $outFolderOp = [Windows.Storage.StorageFolder]::GetFolderFromPathAsync($folderPath)
  $outFolder = AwaitOperation $outFolderOp ([Windows.Storage.StorageFolder])

  $outFileOp = $outFolder.CreateFileAsync($fileName, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)
  $outFile = AwaitOperation $outFileOp ([Windows.Storage.StorageFile])

  $outStreamOp = $outFile.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)
  $outStream = AwaitOperation $outStreamOp ([Windows.Storage.Streams.IRandomAccessStream])

  $encoderOp = [Windows.Graphics.Imaging.BitmapEncoder]::CreateAsync([Windows.Graphics.Imaging.BitmapEncoder]::JpegEncoderId, $outStream)
  $encoder = AwaitOperation $encoderOp ([Windows.Graphics.Imaging.BitmapEncoder])

  $encoder.SetSoftwareBitmap($bitmap)
  $flushOp = $encoder.FlushAsync()
  AwaitAction $flushOp

  $outStream.Dispose()
  $inputStream.Dispose()
} catch {
  throw ("HEIC->JPG conversion failed: {0}`nTip: install 'HEIF Image Extensions' from Microsoft Store, then retry." -f $_)
}
