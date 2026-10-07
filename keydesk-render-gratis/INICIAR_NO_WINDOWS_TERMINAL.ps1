$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 3000
$PanelUrl = "http://127.0.0.1:$Port/api/bootstrap"

Set-Location -LiteralPath $ProjectDir

function Test-KeydeskPanel {
    try {
        $response = Invoke-WebRequest -Uri $PanelUrl -Method Get -TimeoutSec 2
        return ($response.StatusCode -eq 200)
    }
    catch {
        return $false
    }
}

Write-Host 'KEYDESK — iniciador para Windows Terminal' -ForegroundColor Cyan
Write-Host "Pasta do painel: $ProjectDir"

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js 20 ou superior não foi encontrado.' -ForegroundColor Red
    Write-Host 'Instale o Node.js LTS em https://nodejs.org e abra novamente o Windows Terminal.'
    Read-Host 'Pressione Enter para sair'
    exit 1
}

if (-not (Test-Path (Join-Path $ProjectDir 'node_modules/sql.js')) -or
    -not (Test-Path (Join-Path $ProjectDir 'node_modules/localtunnel'))) {
    Write-Host 'Instalando as dependências do painel...'
    npm.cmd install
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Falha ao instalar dependências. Confira a conexão e tente novamente.' -ForegroundColor Red
        Read-Host 'Pressione Enter para sair'
        exit 1
    }
}

if (-not (Test-KeydeskPanel)) {
    $BatchFile = Join-Path $ProjectDir 'INICIAR_NO_WINDOWS.bat'
    if (-not (Test-Path $BatchFile)) {
        Write-Host 'Não encontrei INICIAR_NO_WINDOWS.bat na pasta do projeto.' -ForegroundColor Red
        Read-Host 'Pressione Enter para sair'
        exit 1
    }

    Write-Host 'Iniciando o painel em outra janela...'
    Start-Process -FilePath $BatchFile -WorkingDirectory $ProjectDir

    $Ready = $false
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        if (Test-KeydeskPanel) {
            $Ready = $true
            break
        }
    }

    if (-not $Ready) {
        Write-Host 'O painel não respondeu em 45 segundos. Veja a janela do servidor para identificar o erro.' -ForegroundColor Red
        Read-Host 'Pressione Enter para sair'
        exit 1
    }
}

Write-Host "Painel local ativo em http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host 'Iniciando o túnel público nesta janela. Compartilhe o endereço https://...loca.lt que aparecer.' -ForegroundColor Yellow
Write-Host 'Mantenha esta janela aberta enquanto outras pessoas acessarem o painel.'
Write-Host 'Observação: o LocalTunnel gratuito pode gerar outro endereço quando o túnel reinicia.'
Write-Host ''

$TunnelCommand = Join-Path $ProjectDir 'node_modules/.bin/lt.cmd'
if (-not (Test-Path $TunnelCommand)) {
    Write-Host 'Não encontrei o executável do LocalTunnel. Tente executar npm install novamente.' -ForegroundColor Red
    Read-Host 'Pressione Enter para sair'
    exit 1
}

& $TunnelCommand --port $Port
if ($LASTEXITCODE -ne 0) {
    Write-Host 'O túnel foi encerrado ou ocorreu um erro. O painel local pode continuar aberto na outra janela.' -ForegroundColor Yellow
}
