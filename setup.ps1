# ado-mcp Setup Script
# Run this once to connect ado-mcp to Claude Desktop.
# Right-click this file and choose "Run with PowerShell".

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ado-mcp Setup" -ForegroundColor Cyan
Write-Host "  ==============" -ForegroundColor Cyan
Write-Host ""
Write-Host "  This will connect ado-mcp to Claude Desktop."
Write-Host "  You will need a Personal Access Token from Azure DevOps."
Write-Host ""

# Collect inputs
$orgUrl = Read-Host "  Azure DevOps URL (e.g. https://dev.azure.com/myorg)"
$orgUrl = $orgUrl.TrimEnd("/")

$patSecure = Read-Host "  Personal Access Token" -AsSecureString
$pat = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($patSecure))

$project = Read-Host "  Default project name (optional, press Enter to skip)"

# Paths
$serverPath = Join-Path $PSScriptRoot "dist\index.js"
$configPath  = Join-Path $env:APPDATA "Claude\claude_desktop_config.json"
$configDir   = Split-Path $configPath

# Verify ado-mcp files are present
if (-not (Test-Path $serverPath)) {
    Write-Host ""
    Write-Host "  ERROR: Could not find $serverPath" -ForegroundColor Red
    Write-Host "  Make sure you extracted the full ado-mcp ZIP before running this script." -ForegroundColor Red
    Read-Host "  Press Enter to exit"
    exit 1
}

# Create Claude config directory if it doesn't exist
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir | Out-Null
}

# Read existing config or create empty one
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
    $config = [PSCustomObject]@{ mcpServers = [PSCustomObject]@{} }
}

if (-not $config.PSObject.Properties["mcpServers"]) {
    $config | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue ([PSCustomObject]@{})
}

# Build ado entry
$envObj = [PSCustomObject]@{
    ADO_ORG_URL = $orgUrl
    ADO_PAT     = $pat
}
if ($project -ne "") {
    $envObj | Add-Member -NotePropertyName "ADO_DEFAULT_PROJECT" -NotePropertyValue $project
}

$adoEntry = [PSCustomObject]@{
    command = "node"
    args    = @($serverPath)
    env     = $envObj
}

# Add or update the ado entry (preserves any other MCP servers)
if ($config.mcpServers.PSObject.Properties["ado"]) {
    $config.mcpServers.ado = $adoEntry
} else {
    $config.mcpServers | Add-Member -NotePropertyName "ado" -NotePropertyValue $adoEntry
}

# Write config
$config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8

Write-Host ""
Write-Host "  Done!" -ForegroundColor Green
Write-Host "  Config saved to: $configPath" -ForegroundColor Gray
Write-Host ""
Write-Host "  Restart Claude Desktop to activate the connection." -ForegroundColor Yellow
Write-Host ""
Read-Host "  Press Enter to exit"
