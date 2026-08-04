$content = Get-Content 'js\ug-id-parser.js' -Raw
$split = $content -split '// -----.*?CLI \(Node only\)'
Set-Content -Path 'js\ug-id-parser.js' -Value $split[0]
