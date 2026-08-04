Copy-Item 'Java script BarCode scanner.docx' 'barcode.zip'
Expand-Archive -Path 'barcode.zip' -DestinationPath 'docx_extracted' -Force
$xmlContent = Get-Content 'docx_extracted\word\document.xml' -Raw
$text = $xmlContent -replace '<[^>]+>', ''
Set-Content -Path 'barcode_script.txt' -Value $text
