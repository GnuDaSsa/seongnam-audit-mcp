param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$fileType = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$streamType = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$decoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$bitmapType = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$engineType = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$resultType = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
$languageType = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
$taskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await-Result($operation, $type) {
    $task = $taskMethod.MakeGenericMethod($type).Invoke($null,@($operation))
    $task.Wait()
    return $task.Result
}
$language = [Activator]::CreateInstance($languageType,@('ko'))
$engine = $engineType::TryCreateFromLanguage($language)
if (-not $engine) { throw 'Local Windows Korean OCR language is unavailable.' }
$file = Await-Result ($fileType::GetFileFromPathAsync((Resolve-Path -LiteralPath $ImagePath).Path)) $fileType
$stream = Await-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) $streamType
try {
    $decoder = Await-Result ($decoderType::CreateAsync($stream)) $decoderType
    $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) $bitmapType
    try {
        $result = Await-Result ($engine.RecognizeAsync($bitmap)) $resultType
        [Console]::Write(($result.Lines | ForEach-Object { $_.Text }) -join [Environment]::NewLine)
    } finally { $bitmap.Dispose() }
} finally { $stream.Dispose() }
