$RESOURCE_GROUP  = "rg-litellm-proxy"
$LOCATION        = "centralindia"
$ENV_NAME        = "litellm-env"
$APP_NAME        = "litellm-proxy"
$IMAGE           = "ghcr.io/berriai/litellm:main-latest"
$STAGE_A_ENV_VARS = "LITELLM_MASTER_KEY=sk-stagea-verify-only PORT=4000"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE A -- Pre-flight: Azure CLI Extension Check" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

az extension add --name containerapp --upgrade --output none 2>&1 | Out-Null

$extCheck = az extension list --query "[?name=='containerapp'].name" -o tsv
if (-not $extCheck) {
    Write-Error "[FATAL] The 'containerapp' Azure CLI extension could not be installed. Aborting."
    exit 1
}
Write-Host "[OK] containerapp extension is available." -ForegroundColor Green

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE A -- Step 1: Resource Group" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

Write-Host "Creating resource group '$RESOURCE_GROUP' in '$LOCATION' (idempotent)..."
az group create `
    --name $RESOURCE_GROUP `
    --location $LOCATION `
    --output table

if ($LASTEXITCODE -ne 0) {
    Write-Error "[FATAL] Failed to create resource group. Aborting."
    exit 1
}
Write-Host "[OK] Resource group ready." -ForegroundColor Green

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE A -- Step 2: Container Apps Environment" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "NOTE ON PLAN TYPE:" -ForegroundColor Yellow
Write-Host "  As of 2025/2026, 'az containerapp env create' defaults to Workload" -ForegroundColor Yellow
Write-Host "  Profiles (v2). This is NOT a paid plan. Every v2 environment includes" -ForegroundColor Yellow
Write-Host "  a built-in 'Consumption' workload profile with IDENTICAL free-tier" -ForegroundColor Yellow
Write-Host "  billing (180k vCPU-sec/mo, 360k GiB-sec/mo, 2M req/mo, scale-to-zero)." -ForegroundColor Yellow
Write-Host "  We explicitly set --workload-profile-name Consumption on the container" -ForegroundColor Yellow
Write-Host "  app to guarantee it uses that profile and not a dedicated one." -ForegroundColor Yellow
Write-Host ""

Write-Host "Creating Container Apps Environment '$ENV_NAME'..."
az containerapp env create `
    --name $ENV_NAME `
    --resource-group $RESOURCE_GROUP `
    --location $LOCATION `
    --output table

if ($LASTEXITCODE -ne 0) {
    Write-Error "[FATAL] Environment creation failed. Aborting."
    exit 1
}
Write-Host "[OK] Environment created." -ForegroundColor Green

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE A -- Step 3: Environment Plan Verification" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Querying environment to verify billing plan before deployment..." -ForegroundColor White

Write-Host ""
Write-Host "--- Full environment JSON (workloadProfiles section) ---" -ForegroundColor DarkGray
az containerapp env show `
    --name $ENV_NAME `
    --resource-group $RESOURCE_GROUP `
    --query "properties.workloadProfiles" `
    --output json
Write-Host "--- End of workloadProfiles JSON ---" -ForegroundColor DarkGray
Write-Host ""

$consumptionProfile = az containerapp env show `
    --name $ENV_NAME `
    --resource-group $RESOURCE_GROUP `
    --query "properties.workloadProfiles[?name=='Consumption'].name | [0]" `
    --output tsv

if ($consumptionProfile -eq "Consumption") {
    Write-Host "[OK] VERIFIED: Environment contains a 'Consumption' workload profile." -ForegroundColor Green
    Write-Host "     Free-tier billing confirmed. Proceeding to Stage A deployment." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[WARNING] Could not verify a 'Consumption' workload profile." -ForegroundColor Yellow
    Write-Host "  This may mean:" -ForegroundColor Yellow
    Write-Host "  (a) The environment was created in a region with legacy v1 behavior" -ForegroundColor Yellow
    Write-Host "      (workloadProfiles=null/[] means legacy ConsumptionOnly -- also free)." -ForegroundColor Yellow
    Write-Host "  (b) The Azure CLI output schema changed -- inspect the JSON above." -ForegroundColor Yellow
    Write-Host ""
    $proceed = Read-Host "Do you want to proceed anyway? (y/N)"
    if ($proceed -ne "y" -and $proceed -ne "Y") {
        Write-Host "Aborted by user." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  STAGE A -- Step 4: Bare Image Deploy (Verification Only)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Deploying $IMAGE with DEFAULT entrypoint." -ForegroundColor White
Write-Host "No --command override. No config injection. No IP allowlist." -ForegroundColor White
Write-Host "This deploy's ONLY purpose is to get a live shell for manual checks." -ForegroundColor White
Write-Host ""

az containerapp create `
    --name $APP_NAME `
    --resource-group $RESOURCE_GROUP `
    --environment $ENV_NAME `
    --image $IMAGE `
    --workload-profile-name "Consumption" `
    --cpu 0.5 `
    --memory 1.0Gi `
    --min-replicas 1 `
    --max-replicas 1 `
    --ingress external `
    --target-port 4000 `
    --env-vars $STAGE_A_ENV_VARS `
    --output table

if ($LASTEXITCODE -ne 0) {
    Write-Error "[FATAL] Stage A container app creation failed. Aborting."
    exit 1
}

Write-Host ""
Write-Host "[OK] Container app created. Waiting for replica to become ready..." -ForegroundColor Green

$maxWait  = 180
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
    Write-Host "[WARNING] No replica reached 'Running' state within $maxWait seconds." -ForegroundColor Yellow
    Write-Host "  Check logs with:" -ForegroundColor Yellow
    Write-Host "    az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --follow" -ForegroundColor White
    Write-Host "  Then retry the exec command below once a replica is available." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "[OK] At least 1 replica is in Running state." -ForegroundColor Green
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "  STAGE A -- Manual Verification Checklist" -ForegroundColor Magenta
Write-Host "  (Run these yourself -- do NOT proceed to Stage B until" -ForegroundColor Magenta
Write-Host "   all checks pass)" -ForegroundColor Magenta
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""

Write-Host "STEP 1: Shell into the running container" -ForegroundColor Yellow
Write-Host "  Command:" -ForegroundColor White
Write-Host "    az containerapp exec --name $APP_NAME --resource-group $RESOURCE_GROUP --command /bin/sh" -ForegroundColor Cyan
Write-Host ""
Write-Host "  If that fails (shell not found), try /bin/bash:" -ForegroundColor DarkGray
Write-Host "    az containerapp exec --name $APP_NAME --resource-group $RESOURCE_GROUP --command /bin/bash" -ForegroundColor Cyan
Write-Host ""
Write-Host "  SUCCESS: A shell prompt appears, e.g.:  #  or  /app $" -ForegroundColor Green
Write-Host "  FAILURE: 'Error: exec failed' -- image may be distroless. Stop and report this." -ForegroundColor Red
Write-Host ""

Write-Host "-----------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "STEP 2: Inside the shell -- run each check in order" -ForegroundColor Yellow
Write-Host ""

Write-Host "  CHECK A -- 'sh' is present" -ForegroundColor White
Write-Host "    which sh && echo 'sh: OK'" -ForegroundColor Cyan
Write-Host "  SUCCESS:  /bin/sh  then  sh: OK" -ForegroundColor Green
Write-Host "  FAILURE:  'which: not found' -- Stage B --command override will not work." -ForegroundColor Red
Write-Host ""

Write-Host "  CHECK B -- 'base64' is present and works" -ForegroundColor White
Write-Host "    echo 'aGVsbG8=' | base64 -d && echo '' && echo 'base64: OK'" -ForegroundColor Cyan
Write-Host "  SUCCESS:  hello  then  base64: OK" -ForegroundColor Green
Write-Host "  FAILURE:  'base64: not found' -- the decode approach in Stage B will fail." -ForegroundColor Red
Write-Host ""

Write-Host "  CHECK C -- /app exists and is writable" -ForegroundColor White
Write-Host "    ls -la /app && touch /app/.write_test && echo 'writable: OK' && rm /app/.write_test" -ForegroundColor Cyan
Write-Host "  SUCCESS:  Directory listing, then  writable: OK" -ForegroundColor Green
Write-Host "  FAILURE:  'Permission denied' -- update CONFIG_WRITE_PATH in Stage B." -ForegroundColor Red
Write-Host ""

Write-Host "  CHECK D -- litellm binary and --config flag" -ForegroundColor White
Write-Host "    litellm --version" -ForegroundColor Cyan
Write-Host "  SUCCESS:  e.g.  LiteLLM: v1.98.0" -ForegroundColor Green
Write-Host "  FAILURE:  'litellm: not found' -- wrong image or broken PATH." -ForegroundColor Red
Write-Host ""
Write-Host "    Then confirm --config flag is accepted:" -ForegroundColor White
Write-Host "    litellm --help 2>&1 | grep -i '\-\-config'" -ForegroundColor Cyan
Write-Host "  SUCCESS:  A line containing '--config' and a path description" -ForegroundColor Green
Write-Host "  FAILURE:  No output -- the --config syntax in Stage B is incorrect." -ForegroundColor Red
Write-Host ""

Write-Host "  CHECK E -- End-to-end decode + write dry run (simulates Stage B)" -ForegroundColor White
Write-Host "    TEST_B64=`$(echo 'model_list: []' | base64)" -ForegroundColor Cyan
Write-Host "    echo `$TEST_B64 | base64 -d > /app/litellm_config_test.yaml && echo 'decode+write: OK'" -ForegroundColor Cyan
Write-Host "  SUCCESS:  decode+write: OK" -ForegroundColor Green
Write-Host "  FAILURE:  Any error -- pinpoints exactly what Stage B will crash on." -ForegroundColor Red
Write-Host ""

Write-Host "-----------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "STEP 3: Exit the shell" -ForegroundColor Yellow
Write-Host "    exit" -ForegroundColor Cyan
Write-Host ""

Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host "  IF ALL CHECKS PASS: Run deploy-aca-stage-b.ps1" -ForegroundColor Magenta
Write-Host "  IF ANY CHECK FAILS: Fix Stage B before proceeding." -ForegroundColor Magenta
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "[STAGE A COMPLETE]" -ForegroundColor Green
