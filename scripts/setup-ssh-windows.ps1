# Setup SSH Lightsail no Windows
# Execute na pasta raiz do repositório clonado:
#   .\scripts\setup-ssh-windows.ps1

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent

$keyName = "LightsailDefaultKey-sa-east-1.pem"
$keyPath = Join-Path $repoRoot $keyName
$sshDir = Join-Path $env:USERPROFILE ".ssh"
$configPath = Join-Path $sshDir "config"
$exampleConfig = Join-Path $repoRoot "ssh\config.example"

Write-Host "Repositorio: $repoRoot"
Write-Host ""

if (-not (Test-Path $keyPath)) {
    Write-Host "ERRO: Chave nao encontrada em:" -ForegroundColor Red
    Write-Host "  $keyPath"
    Write-Host ""
    Write-Host "Copie o arquivo $keyName da maquina original para esta pasta e execute novamente."
    exit 1
}

Write-Host "Chave encontrada: $keyPath" -ForegroundColor Green

# Permissoes da chave
icacls $keyPath /inheritance:r | Out-Null
icacls $keyPath /grant:r "${env:USERNAME}:(R)" | Out-Null
Write-Host "Permissoes da chave ajustadas." -ForegroundColor Green

# Pasta .ssh
New-Item -ItemType Directory -Force -Path $sshDir | Out-Null

# Gerar config com caminho real desta maquina
$configContent = @"
Host lightsail
  HostName 54.20.4.21
  User ubuntu
  IdentityFile "$keyPath"

"@

if (Test-Path $configPath) {
    $existing = Get-Content $configPath -Raw
    if ($existing -match "Host lightsail") {
        Write-Host "Bloco 'Host lightsail' ja existe em $configPath" -ForegroundColor Yellow
        Write-Host "Edite manualmente se necessario."
    } else {
        Add-Content -Path $configPath -Value "`n$configContent"
        Write-Host "Bloco 'Host lightsail' adicionado ao config existente." -ForegroundColor Green
    }
} else {
    Set-Content -Path $configPath -Value $configContent -Encoding UTF8
    Write-Host "Config criado em: $configPath" -ForegroundColor Green
}

Write-Host ""
Write-Host "Testando conexao SSH..." -ForegroundColor Cyan
ssh -o BatchMode=yes -o ConnectTimeout=15 lightsail "echo 'Conexao OK' && uname -a"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Setup concluido! Agora conecte no Cursor:" -ForegroundColor Green
    Write-Host "  Ctrl+Shift+P -> Remote-SSH: Connect to Host... -> lightsail"
} else {
    Write-Host ""
    Write-Host "Falha no teste SSH. Veja docs/setup-lightsail-ssh.md" -ForegroundColor Red
    exit 1
}
