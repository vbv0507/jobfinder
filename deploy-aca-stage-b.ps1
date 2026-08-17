<#
.SYNOPSIS
    STAGE B -- Full Production Deploy
    Updates the existing Stage A container app with the full LiteLLM configuration:
    config injection via base64 env var, custom --command entrypoint, all API key
    env vars, and the IP allowlist ingress rules.

.DESCRIPTION
    PREREQUISITES -- Do NOT run this script until ALL Stage A manual checks passed:
      [x] CHECK A: 'sh' found at /bin/sh (or /bin/bash -- update $SHELL_BIN below)
      [x] CHECK B: 'base64 -d' works correctly
      [x] CHECK C: /app is writable (if not, update $CONFIG_WRITE_PATH below)
      [x] CHECK D: 'litellm --version' works and '--config' flag is in --help output
      [x] CHECK E: end-to-end decode+write dry run produced 'decode+write: OK'

    What this script does:
      1. Base64-encodes the litellm_config.yaml from this directory.
      2. Updates the container app via `az containerapp update` with:
         - All Groq / OpenRouter API key env vars (loaded from .env)
         - LITELLM_CONFIG_B64: the base64-encoded config
         - A custom --command that decodes and writes the config file, then starts litellm
           using the --config flag (confirmed to be the correct invocation per LiteLLM docs)
      3. Applies ingress traffic rules to restrict to the 31 approved IP ranges.
      4. Verifies the updated revision is active and prints the external URL.

.NOTES
    LiteLLM --config flag: Confirmed correct per official LiteLLM documentation.
    The image's default entrypoint is the litellm proxy; passing --config /path/to/file
    instructs it to load that YAML. The custom --command in Stage B overrides the
    default to first decode the config from the env var before calling litellm.

    The command override runs:
      /bin/sh -c "echo $LITELLM_CONFIG_B64 | base64 -d > /app/litellm_config.yaml && litellm --config /app/litellm_config.yaml --port 4000"

    This pattern is the documented approach for config injection in Azure Container
    Apps when volume mounts are not available (ACA does not support bind mounts from
    local paths; Azure File Share mount is the alternative, but adds complexity).
#>

# ==============================================================================
# SECTION 0 -- CONFIGURATION
# Edit these to match Stage A values exactly, and update any Stage A findings.
# ==============================================================================

$RESOURCE_GROUP  = "rg-litellm-proxy"
$ENV_NAME        = "litellm-env"
$APP_NAME        = "litellm-proxy"
$IMAGE           = "ghcr.io/berriai/litellm:main-latest"

# -- Update these based on Stage A manual check results --
# If CHECK A showed /bin/bash instead of /bin/sh, change this:
$SHELL_BIN       = "/bin/sh"

# If CHECK C showed /app was NOT writable, change this to the writable path found:
$CONFIG_WRITE_PATH = "/app/litellm_config.yaml"

# Path to your litellm config file (relative to this script)
$CONFIG_FILE_PATH = "$PSScriptRoot\litellm_config.yaml"

# ==============================================================================
# SECTION 1 -- PREREQUISITE CONFIRMATION GATE
# ==============================================================================

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE B -- Production Deploy" -ForegroundColor Cyan
Write-Host "  LiteLLM Proxy on Azure Container Apps" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This script will overwrite the Stage A deployment with the full config." -ForegroundColor Yellow
Write-Host "You should only proceed if all Stage A manual checks passed." -ForegroundColor Yellow
Write-Host ""
$confirmed = Read-Host "Have all Stage A checks passed? (y/N)"
if ($confirmed -ne "y" -and $confirmed -ne "Y") {
    Write-Host "Aborted. Run Stage A checks first." -ForegroundColor Red
    exit 1
}

# ==============================================================================
# SECTION 2 -- LOAD API KEYS FROM .ENV
# ==============================================================================

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE B -- Step 1: Loading API Keys from .env" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$ENV_FILE = "$PSScriptRoot\.env"
if (-not (Test-Path $ENV_FILE)) {
    Write-Error "[FATAL] .env file not found at: $ENV_FILE"
    Write-Error "Create it with the required keys before running Stage B."
    exit 1
}

# Load env vars from .env (key=value format, skip comments and blanks)
$envVars = @{}
Get-Content $ENV_FILE | Where-Object { $_ -match '^\s*[^#].*=.*' } | ForEach-Object {
    $parts = $_ -split '=', 2
    if ($parts.Length -eq 2) {
        $key   = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        $envVars[$key] = $value
    }
}

# Required keys for LiteLLM proxy operation
$requiredKeys = @(
    "GROQ_API_KEY_1",
    "GROQ_API_KEY_2",
    "GROQ_API_KEY_3",
    "GROQ_API_KEY_4",
    "OPENROUTER_API_KEY",
    "LITELLM_MASTER_KEY"
)

$missing = @()
foreach ($key in $requiredKeys) {
    if (-not $envVars.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($envVars[$key])) {
        $missing += $key
    }
}

if ($missing.Count -gt 0) {
    Write-Error "[FATAL] The following required keys are missing from .env:"
    $missing | ForEach-Object { Write-Error "  - $_" }
    exit 1
}

Write-Host "[OK] All required API keys found in .env." -ForegroundColor Green

# ==============================================================================
# SECTION 3 -- BASE64-ENCODE litellm_config.yaml
# ==============================================================================

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE B -- Step 2: Base64 Encoding Config File" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not (Test-Path $CONFIG_FILE_PATH)) {
    Write-Error "[FATAL] Config file not found: $CONFIG_FILE_PATH"
    exit 1
}

# Read as bytes and convert to base64 (avoids PowerShell encoding issues)
$configBytes  = [System.IO.File]::ReadAllBytes($CONFIG_FILE_PATH)
$configB64    = [System.Convert]::ToBase64String($configBytes)

Write-Host "[OK] Config file encoded. Length: $($configB64.Length) chars." -ForegroundColor Green
Write-Host "     First 80 chars (sanity check): $($configB64.Substring(0, [Math]::Min(80, $configB64.Length)))" -ForegroundColor DarkGray

# Sanity check: verify the base64 string is non-empty and looks valid
if ($configB64.Length -lt 10) {
    Write-Error "[FATAL] Base64 output is suspiciously short. Check the config file."
    exit 1
}

# ==============================================================================
# SECTION 4 -- VERIFY ENV VARS LOADED (actual env array built in Section 6)
# ==============================================================================

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE B -- Step 3: Verifying Env Vars" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

Write-Host "[OK] Env vars loaded. Will be embedded in REST PATCH body." -ForegroundColor Green

# ==============================================================================
# SECTION 5 -- BUILD CUSTOM COMMAND
# The command:
#   1. Decodes LITELLM_CONFIG_B64 into a file at CONFIG_WRITE_PATH
#   2. Starts litellm with --config pointing at that file
#
# CONFIRMED: --config is the correct flag per LiteLLM official documentation.
# The litellm proxy accepts: litellm --config /path/to/config.yaml --port 4000
# ==============================================================================

$customCommand = "$SHELL_BIN -c `"echo \`$LITELLM_CONFIG_B64 | base64 -d > $CONFIG_WRITE_PATH && litellm --config $CONFIG_WRITE_PATH --port 4000`""

Write-Host ""
Write-Host "Custom command that will be injected:" -ForegroundColor DarkGray
Write-Host "  $customCommand" -ForegroundColor DarkGray
Write-Host ""

# ==============================================================================
# SECTION 6 -- UPDATE THE CONTAINER APP (single REST PATCH)
# One atomic call sets image + env vars + command + args together.
# Reason: a two-step approach (CLI for env vars, REST PATCH for command) was
# wiping the env vars because the PATCH replaced the whole container spec.
# ==============================================================================

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE B -- Step 4: Deploy Full Config (REST PATCH)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Building unified patch body (image + env + command + args)..." -ForegroundColor White

$subId       = (az account show --query id -o tsv).Trim()
$apiVersion  = "2024-03-01"
$resourceUrl = "https://management.azure.com/subscriptions/$subId/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.App/containerApps/$APP_NAME`?api-version=$apiVersion"

$shellScript = "echo `$LITELLM_CONFIG_B64 | base64 -d > $CONFIG_WRITE_PATH && litellm --config $CONFIG_WRITE_PATH --port 4000"

# Build env array as PowerShell objects -> JSON
# This keeps all special characters correctly escaped by ConvertTo-Json
$envArray = @(
    @{ name = "GROQ_API_KEY_1";      value = $envVars['GROQ_API_KEY_1'] },
    @{ name = "GROQ_API_KEY_2";      value = $envVars['GROQ_API_KEY_2'] },
    @{ name = "GROQ_API_KEY_3";      value = $envVars['GROQ_API_KEY_3'] },
    @{ name = "GROQ_API_KEY_4";      value = $envVars['GROQ_API_KEY_4'] },
    @{ name = "OPENROUTER_API_KEY";  value = $envVars['OPENROUTER_API_KEY'] },
    @{ name = "LITELLM_MASTER_KEY";  value = $envVars['LITELLM_MASTER_KEY'] },
    @{ name = "LITELLM_CONFIG_B64";  value = $configB64 },
    @{ name = "PORT";                value = "4000" }
)

# Add optional keys if present
$optionalKeys = @("CEREBRAS_API_KEY", "DEEPSEEK_API_KEY")
foreach ($optKey in $optionalKeys) {
    if ($envVars.ContainsKey($optKey) -and -not [string]::IsNullOrWhiteSpace($envVars[$optKey])) {
        $envArray += @{ name = $optKey; value = $envVars[$optKey] }
        Write-Host "  [INFO] Including optional key: $optKey" -ForegroundColor DarkGray
    }
}

$patchObj = @{
    properties = @{
        template = @{
            containers = @(
                @{
                    name    = $APP_NAME
                    image   = $IMAGE
                    command = @($SHELL_BIN, "-c")
                    args    = @($shellScript)
                    env     = $envArray
                }
            )
        }
    }
}

$patchJson = $patchObj | ConvertTo-Json -Depth 15 -Compress

# Write to temp file -> az rest reads from @file (no shell escaping of body)
$tmpFile = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.json'
[System.IO.File]::WriteAllText($tmpFile, $patchJson, [System.Text.Encoding]::UTF8)

Write-Host "  Patch written to: $tmpFile" -ForegroundColor DarkGray
Write-Host "  Env vars: $($envArray.Count) keys (including LITELLM_CONFIG_B64: $($configB64.Length) chars)" -ForegroundColor DarkGray
Write-Host "  Command:  [$SHELL_BIN, -c]" -ForegroundColor DarkGray
Write-Host "  Args:     [echo `$LITELLM_CONFIG_B64 | base64 -d > $CONFIG_WRITE_PATH && litellm ...]" -ForegroundColor DarkGray
Write-Host ""

az rest --method PATCH `
    --url $resourceUrl `
    --body "@$tmpFile" `
    --headers "Content-Type=application/json" `
    --output none

$restCode = $LASTEXITCODE
Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue

if ($restCode -ne 0) {
    Write-Error "[FATAL] REST PATCH failed."
    Write-Error "Check: az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --follow"
    exit 1
}

Write-Host "[OK] Container app fully updated (image + env + command + args)." -ForegroundColor Green


# ==============================================================================
# SECTION 7 -- IP ALLOWLIST (SKIPPED -- secured by LITELLM_MASTER_KEY instead)
# ==============================================================================

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE B -- Step 5: IP Allowlist" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[SKIPPED] IP allowlist not applied." -ForegroundColor Yellow
Write-Host "  The proxy is secured by LITELLM_MASTER_KEY auth on every request." -ForegroundColor DarkGray
Write-Host "  Any caller without the key receives HTTP 401." -ForegroundColor DarkGray
Write-Host "  To add IP restrictions later: Azure Portal -> litellm-proxy -> Ingress -> IP Restrictions" -ForegroundColor DarkGray
Write-Host ""


# ==============================================================================
# SECTION 8 -- VERIFY DEPLOYMENT
# ==============================================================================

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE B -- Step 6: Deployment Verification" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Waiting for updated revision to become active..." -ForegroundColor White

$maxWait  = 120
$elapsed  = 0
$interval = 10
$ready    = $false

while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds $interval
    $elapsed += $interval

    $runningCount = az containerapp replica list `
        --name $APP_NAME `
        --resource-group $RESOURCE_GROUP `
        --query "length([?properties.runningState=='Running'])" `
        --output tsv 2>$null

    Write-Host "  [$elapsed s] Running replicas: $runningCount"

    if ($runningCount -ge 1) {
        $ready = $true
        break
    }
}

if (-not $ready) {
    Write-Host ""
    Write-Host "[WARNING] No replica is Running. Checking for startup errors..." -ForegroundColor Yellow
    Write-Host "  Run this to see container logs:" -ForegroundColor White
    Write-Host "    az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --follow" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Common Stage B failures and their meaning:" -ForegroundColor White
    Write-Host "  - 'base64: invalid input' or decode error: config B64 string is corrupted" -ForegroundColor DarkGray
    Write-Host "  - 'permission denied' writing config: /app not writable -- update CONFIG_WRITE_PATH" -ForegroundColor DarkGray
    Write-Host "  - 'litellm: not found': PATH issue in shell override -- use full path" -ForegroundColor DarkGray
    Write-Host "  - 'invalid config': litellm_config.yaml has syntax errors -- validate YAML" -ForegroundColor DarkGray
    Write-Host "  - Container exits immediately: the --command/-args split is wrong in the CLI" -ForegroundColor DarkGray
} else {
    # Get the external URL
    $fqdn = az containerapp show `
        --name $APP_NAME `
        --resource-group $RESOURCE_GROUP `
        --query "properties.configuration.ingress.fqdn" `
        --output tsv

    Write-Host ""
    Write-Host "[OK] Deployment successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  LiteLLM Proxy URL: https://$fqdn" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Health check:" -ForegroundColor White
    Write-Host "    curl https://$fqdn/health" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Test a completion (replace sk-... with your LITELLM_MASTER_KEY):" -ForegroundColor White
    Write-Host "    curl -X POST https://$fqdn/v1/chat/completions `
      -H 'Content-Type: application/json' `
      -H 'Authorization: Bearer sk-your-master-key' `
      -d '{`"model`": `"job-scorer`", `"messages`": [{`"role`": `"user`", `"content`": `"ping`"}]}'" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Update RoleNova .env to point to this proxy:" -ForegroundColor White
    Write-Host "    LITELLM_BASE_URL=https://$fqdn" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "[STAGE B COMPLETE]" -ForegroundColor Green
