<#
.SYNOPSIS
Provisions the Azure Entra ID app registration VirtualOffice signs in with (F2).

.DESCRIPTION
Creates or updates a single app registration that serves both login surfaces:
the world (play's /openid-callback) and the administration dashboard
(admin-api's /admin/callback). Registers the redirect URIs, requests the email
and preferred_username claims in the ID token, creates a client secret, and
prints the exact OPENID_* block for the repository-root .env.

Idempotent: re-running finds the registration by display name and completes
whatever is missing. The only thing a re-run always creates anew is the client
secret, because secrets cannot be read back after creation.

Requires the Azure CLI ("az"), logged into the tenant that owns your users
(az login), with permission to create app registrations.

.PARAMETER PlayUrl
Public URL of the world, scheme included, no trailing slash.
Example: https://play.example.com

.PARAMETER AdminApiUrl
Public URL of the admin-api service (the dashboard), scheme included.
Example: https://admin.example.com

.PARAMETER DisplayName
Display name of the app registration. Default: VirtualOffice.

.PARAMETER SecretMonths
Client secret lifetime in months. Default 3, matching the 90-day rotation
policy; raise it consciously if your policy differs.

.EXAMPLE
./setup-entra-id.ps1 -PlayUrl https://play.example.com -AdminApiUrl https://admin.example.com

.NOTES
Exit codes: 0 success; 1 the parameters are wrong; 2 the environment is wrong
(az missing or not logged in); 3 Entra answered an error.
The client secret is printed ONCE and never written to disk.
#>
param(
    [Parameter(Mandatory = $true)][string]$PlayUrl,
    [Parameter(Mandatory = $true)][string]$AdminApiUrl,
    [string]$DisplayName = "VirtualOffice",
    [ValidateRange(1, 24)][int]$SecretMonths = 3
)

$ErrorActionPreference = "Stop"

function Write-Info($message) { Write-Host $message -ForegroundColor Cyan }
function Write-Ok($message) { Write-Host $message -ForegroundColor Green }
function Write-Warning2($message) { Write-Host $message -ForegroundColor Yellow }
function Write-Fail($message) { Write-Host $message -ForegroundColor Red }

# --- 1. Validate parameters before touching anything -------------------------

foreach ($entry in @(@{ Name = "PlayUrl"; Value = $PlayUrl }, @{ Name = "AdminApiUrl"; Value = $AdminApiUrl })) {
    $parsed = $null
    if (-not [System.Uri]::TryCreate($entry.Value, [System.UriKind]::Absolute, [ref]$parsed) -or
        ($parsed.Scheme -ne "http" -and $parsed.Scheme -ne "https")) {
        Write-Fail ("{0} is not an absolute http(s) URL: {1}" -f $entry.Name, $entry.Value)
        exit 1
    }
    if ($parsed.Scheme -eq "http") {
        Write-Warning2 ("{0} uses http. Entra allows it only for localhost; anything else must be https." -f $entry.Name)
    }
}

$PlayUrl = $PlayUrl.TrimEnd("/")
$AdminApiUrl = $AdminApiUrl.TrimEnd("/")

# Byte for byte what the services build. play: PUSHER_URL + /openid-callback and /logout-callback.
# admin-api: ADMIN_API_PUBLIC_URL + /admin/callback. A URI that differs by one character fails with AADSTS50011.
$redirectUris = @(
    "$PlayUrl/openid-callback",
    "$PlayUrl/logout-callback",
    "$AdminApiUrl/admin/callback"
)

# --- 2. Validate the environment ---------------------------------------------

if ($null -eq (Get-Command "az" -ErrorAction SilentlyContinue)) {
    Write-Fail "The Azure CLI (az) is not installed. https://learn.microsoft.com/cli/azure/install-azure-cli"
    exit 2
}

$accountJson = az account show --output json
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Not logged into Azure. Run: az login --tenant <your tenant>"
    exit 2
}
$account = $accountJson | ConvertFrom-Json
$tenantId = $account.tenantId

Write-Info ("Tenant: {0} ({1})" -f $account.name, $tenantId)
Write-Info ("Signed in as: {0}" -f $account.user.name)

# --- 3. Find or create the app registration (idempotent) ---------------------

$existingJson = az ad app list --display-name $DisplayName --output json
if ($LASTEXITCODE -ne 0) { Write-Fail "Could not list app registrations."; exit 3 }
$existing = @($existingJson | ConvertFrom-Json)

if ($existing.Count -gt 1) {
    Write-Fail ("{0} app registrations are named '{1}'. Rename or delete the strays, then re-run." -f $existing.Count, $DisplayName)
    exit 1
}

if ($existing.Count -eq 1) {
    $appId = $existing[0].appId
    Write-Info ("Found existing app registration '{0}' ({1}); updating it." -f $DisplayName, $appId)

    az ad app update --id $appId --web-redirect-uris @redirectUris --sign-in-audience AzureADMyOrg --enable-id-token-issuance false --output none
    if ($LASTEXITCODE -ne 0) { Write-Fail "Could not update the redirect URIs."; exit 3 }
} else {
    Write-Info ("Creating app registration '{0}'." -f $DisplayName)

    $createdJson = az ad app create --display-name $DisplayName --web-redirect-uris @redirectUris --sign-in-audience AzureADMyOrg --enable-id-token-issuance false --output json
    if ($LASTEXITCODE -ne 0) { Write-Fail "Could not create the app registration."; exit 3 }
    $appId = ($createdJson | ConvertFrom-Json).appId
}

Write-Ok ("App registration ready: {0}" -f $appId)

# --- 4. Ask for the email claim in the ID token -------------------------------

# Both services read the user's email; Entra only emits the claim when it is asked for. preferred_username is
# present by default on v2 tokens and is requested anyway so the configuration says what the services rely on.
$claimsFile = New-TemporaryFile
try {
    $claims = @{
        idToken = @(
            @{ name = "email"; essential = $false },
            @{ name = "preferred_username"; essential = $false }
        )
    } | ConvertTo-Json -Depth 4

    # UTF-8 without BOM: az on PowerShell 5.1 misparses a BOM-prefixed JSON argument file.
    [System.IO.File]::WriteAllText($claimsFile.FullName, $claims, (New-Object System.Text.UTF8Encoding($false)))

    az ad app update --id $appId --optional-claims ("@" + $claimsFile.FullName) --output none
    if ($LASTEXITCODE -ne 0) {
        # Older az versions lack --optional-claims on update. Not fatal: the portal path is in the setup doc.
        Write-Warning2 "Could not set the optional claims from here (older az?). Add the 'email' optional claim to the ID token manually: Entra portal > App registrations > Token configuration."
    } else {
        Write-Ok "Optional claims configured: email, preferred_username in the ID token."
    }
} finally {
    Remove-Item $claimsFile.FullName -Force -ErrorAction SilentlyContinue
}

# --- 5. Create a client secret (always new; secrets cannot be read back) ------

$endDate = (Get-Date).ToUniversalTime().AddMonths($SecretMonths).ToString("yyyy-MM-ddTHH:mm:ssZ")
$secretName = "virtualoffice-" + (Get-Date).ToUniversalTime().ToString("yyyyMMdd")

$secretJson = az ad app credential reset --id $appId --append --display-name $secretName --end-date $endDate --output json
if ($LASTEXITCODE -ne 0) { Write-Fail "Could not create the client secret."; exit 3 }
$secret = ($secretJson | ConvertFrom-Json).password

# --- 6. Closing banner: the .env block, printed once --------------------------

Write-Host ""
Write-Ok "Done. Copy this block into the repository-root .env (values are printed ONCE and are not saved anywhere):"
Write-Host ""
Write-Host ("OPENID_CLIENT_ID=" + $appId)
Write-Host ("OPENID_CLIENT_SECRET=" + $secret)
Write-Host ("OPENID_CLIENT_ISSUER=https://login.microsoftonline.com/" + $tenantId + "/v2.0")
Write-Host "OPENID_SCOPE=openid profile email"
Write-Host "OPENID_USERNAME_CLAIM=preferred_username"
Write-Host ""
Write-Info "Next steps:"
Write-Info "  1. Put the block in .env (or your secret store) and recreate the stack: docker compose up -d"
Write-Info ("  2. The secret expires on {0} (about {1} months). Re-run this script to rotate it." -f $endDate, $SecretMonths)
Write-Info "  3. Verify with docs/SETUP-CLOUD-AZURE.md, section 'Verification'."

exit 0
