$files = @("js\ug-id-parser.js", "js\scanner.js", "js\app.js")
foreach ($file in $files) {
    $content = Get-Content -Path $file -Raw
    $content = $content -replace 'export class ', 'class '
    $content = $content -replace 'export function ', 'function '
    $content = $content -replace 'import .*? from .*?;', ''
    Set-Content -Path $file -Value $content
}
