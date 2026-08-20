# 咬字 一鍵安裝與環境體檢
# 用法:點兩下 setup.bat,或在 PowerShell 執行 .\setup.ps1
# 重複執行安全:只補缺的東西,不會重裝已存在的。

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Test-Cmd($name) {
    return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

# 找「真的」Python:排除 Microsoft Store 的假 python(App execution alias,
# 執行只會開商店),並實際跑 --version 驗證;找不到就退回 py 啟動器。
# 回傳可執行的路徑或 "py",都沒有回傳 $null。
function Get-Python {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notlike "*\WindowsApps\*") {
        try {
            if ((& $cmd.Source --version 2>&1) -match "^Python \d") { return $cmd.Source }
        } catch {}
    }
    if (Test-Cmd "py") {
        try {
            if ((& py -3 --version 2>&1) -match "^Python \d") { return "py" }
        } catch {}
    }
    return $null
}

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

function Install-Winget($id, $label) {
    Write-Host ">> 安裝 $label ..." -ForegroundColor Yellow
    winget install -e --id $id --accept-source-agreements --accept-package-agreements
    Refresh-Path
}

Write-Host "=== 咬字 環境安裝 ===" -ForegroundColor Green

# --- 1. Python ---
$python = Get-Python
if ($null -eq $python) {
    Install-Winget "Python.Python.3.13" "Python 3.13"
    $python = Get-Python
}
if ($null -eq $python) { throw "Python 安裝後仍找不到,請重開終端機再跑一次 setup" }

# --- 2. ffmpeg ---
if (-not (Test-Cmd "ffmpeg")) {
    Install-Winget "Gyan.FFmpeg" "ffmpeg"
}

# --- 3. Python 虛擬環境與套件 ---
$venvPy = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host ">> 建立 Python 虛擬環境 ..." -ForegroundColor Yellow
    if ($python -eq "py") { py -3 -m venv .venv } else { & $python -m venv .venv }
}
$lock = "backend\requirements.lock.txt"
$req = if (Test-Path $lock) { $lock } else { "backend\requirements.txt" }
Write-Host ">> 安裝 Python 套件($req)..." -ForegroundColor Yellow
& $venvPy -m pip install --quiet --upgrade pip
& $venvPy -m pip install --quiet -r $req

# --- 4. 前端(已有 dist 就跳過,不需要 Node)---
if (-not (Test-Path "frontend\dist\index.html")) {
    if (-not (Test-Cmd "npm")) {
        Install-Winget "OpenJS.NodeJS.LTS" "Node.js"
    }
    Write-Host ">> 建置前端 ..." -ForegroundColor Yellow
    Push-Location frontend
    npm ci --no-audit --no-fund
    npm run build
    Pop-Location
}

# --- 5. 模型搬遷(舊版存在使用者快取的話,搬進專案 models/ 免重載)---
$hubCache = "$env:USERPROFILE\.cache\huggingface\hub"
if (Test-Path $hubCache) {
    Get-ChildItem $hubCache -Directory -Filter "models--Systran--faster-whisper-*" -ErrorAction SilentlyContinue | ForEach-Object {
        $dest = "models\$($_.Name)"
        if (-not (Test-Path $dest)) {
            Write-Host ">> 搬遷模型 $($_.Name) 進專案資料夾 ..." -ForegroundColor Yellow
            robocopy $_.FullName $dest /E /NFL /NDL /NJH /NJS | Out-Null
        }
    }
}

# --- 體檢報告 ---
Write-Host ""
Write-Host "=== 體檢報告 ===" -ForegroundColor Green

function Report($label, $ok, $detail) {
    $mark = if ($ok) { "[OK]" } else { "[缺]" }
    $color = if ($ok) { "Green" } else { "Red" }
    Write-Host ("{0} {1,-14} {2}" -f $mark, $label, $detail) -ForegroundColor $color
}

$pyOk = $null -ne (Get-Python)
$pyVer = if ($pyOk) { if ($python -eq "py") { (py -3 --version) } else { (& $python --version) } } else { "找不到真的 Python(注意 Microsoft Store 的假 python)" }
Report "Python" $pyOk $pyVer

$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
Report "ffmpeg" ($null -ne $ff) $(if ($ff) { $ff.Source } else { "辨識與匯出需要它" })

Report "Python 套件" (Test-Path $venvPy) $(if (Test-Path $venvPy) { ".venv 已建立" } else { "" })

Report "前端" (Test-Path "frontend\dist\index.html") "frontend\dist"

$gpu = Test-Cmd "nvidia-smi"
$gpuName = if ($gpu) { (nvidia-smi --query-gpu=name --format="csv,noheader" | Select-Object -First 1) } else { "沒有 NVIDIA 驅動,會用 CPU 辨識(較慢但可用)" }
Report "NVIDIA GPU" $gpu $gpuName

$model = Test-Path "models\models--Systran--faster-whisper-large-v3"
Report "Whisper 模型" $model $(if ($model) { "models\ 已就緒" } else { "第一次辨識時會自動下載約 3GB" })

$claude = Test-Cmd "claude"
Report "Claude Code" $claude $(if ($claude) { "AI 校正可用" } else { "未安裝(選配):AI 校正功能會隱藏" })

Write-Host ""
Write-Host "完成!點兩下 start.bat 開始使用。" -ForegroundColor Green
Write-Host "(如果剛剛有安裝新程式,建議先關掉這個視窗再開 start.bat)"
