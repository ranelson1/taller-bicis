# Arranca TallerBicis en local (Windows): PostgreSQL en Docker + API (8080) + web (5173).
# Uso:  .\dev.ps1      (o doble clic en dev.cmd)
#
# La primera vez crea la base desde cero: esquema, usuario de la app (taller_app), superadmin
# y el taller demo (seed/demo-sendero.json). Las credenciales quedan en .env.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function New-Secret($n) {
  $chars = [char[]]'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  -join (1..$n | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
}

# 1. Variables: se leen de .env (gitignored). Si no existe, se crea con valores nuevos.
$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) {
  @(
    '# La app se conecta con un usuario sin privilegios para que Row Level Security aisle a cada taller.'
    'DATABASE_URL=postgresql://taller_app:taller_app@localhost:5432/taller'
    '# Usuario dueno de la base: solo para migraciones y scripts de administracion.'
    'DATABASE_URL_ADMIN=postgresql://taller:taller@localhost:5432/taller'
    "SESSION_SECRET=$(New-Secret 48)"
    '# Superadmin local de la plataforma (crea talleres).'
    'SUPERADMIN_EMAIL=superadmin@plataforma.local'
    "SUPERADMIN_PASSWORD=$(New-Secret 16)"
    '# Contrasena de los usuarios del taller demo.'
    "DEMO_USERS_PASSWORD=$(New-Secret 12)"
  ) | Set-Content -Encoding utf8 $envFile
  Write-Host "Creado .env con credenciales nuevas."
}
$vars = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim('"') }
}

# 2. PostgreSQL en Docker (contenedor taller-db, volumen taller-db-data).
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker no responde. Abre Docker Desktop y vuelve a intentar.' }
$state = docker ps -a --filter 'name=^taller-db$' --format '{{.State}}'
$fresh = $false
if (-not $state) {
  Write-Host 'Creando contenedor taller-db...'
  docker run -d --name taller-db -e POSTGRES_USER=taller -e POSTGRES_PASSWORD=taller -e POSTGRES_DB=taller `
    -p 5432:5432 -v taller-db-data:/var/lib/postgresql/data postgres:16 | Out-Null
  $fresh = $true
} elseif ($state -ne 'running') {
  docker start taller-db | Out-Null
}
Write-Host -NoNewline 'Esperando a PostgreSQL'
for ($i = 0; $i -lt 30; $i++) {
  docker exec taller-db pg_isready -U taller -d taller *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Write-Host -NoNewline '.'; Start-Sleep 1
}
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL no respondio a tiempo.' }
Write-Host ' listo.'

# 3. Base nueva: esquema, usuario de la app, superadmin y taller demo.
$hasTables = docker exec taller-db psql -U taller -d taller -t -A -c "select to_regclass('public.workshops') is not null"
if ($hasTables.Trim() -ne 't') {
  Write-Host 'Base vacia: creando esquema y datos iniciales...'
  Get-Content -Raw 'lib\db\schema.sql' | docker exec -i taller-db psql -U taller -d taller -v ON_ERROR_STOP=1 -q
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el esquema.' }
  $appPassword = ([uri]($vars['DATABASE_URL'] -replace '^postgresql', 'http')).UserInfo.Split(':')[1]
  Get-Content -Raw 'lib\db\scripts\grant-app-role.sql' | docker exec -i taller-db psql -U taller -d taller -v ON_ERROR_STOP=1 -v app_password=$appPassword -q
  foreach ($k in $vars.Keys) { Set-Item -Path "env:$k" -Value $vars[$k] }
  pnpm --filter @workspace/api-server run create-superadmin
  pnpm --filter @workspace/api-server run load-demo -- seed/demo-sendero.json
}

# 4. API y web, cada una en su propia ventana (cerrar la ventana detiene el proceso).
function Start-Window($title, $extra, $cmd) {
  $all = $vars.Clone(); foreach ($k in $extra.Keys) { $all[$k] = $extra[$k] }
  $sets = ($all.GetEnumerator() | ForEach-Object { "`$env:$($_.Key)='$($_.Value -replace "'", "''")'" }) -join '; '
  Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command',
    "`$Host.UI.RawUI.WindowTitle='$title'; Set-Location '$PSScriptRoot'; $sets; $cmd"
}
Start-Window 'TallerBicis API :8080' @{ PORT = '8080' } 'pnpm --filter @workspace/api-server run dev'
Start-Window 'TallerBicis Web :5173' @{ PORT = '5173'; BASE_PATH = '/'; API_PROXY_TARGET = 'http://localhost:8080' } `
  'pnpm --filter @workspace/workshop-app run dev'

Write-Host 'API: http://localhost:8080   Web: http://localhost:5173'
Write-Host "Superadmin: $($vars['SUPERADMIN_EMAIL']) (clave en .env)"
Start-Sleep 4
Start-Process 'http://localhost:5173'
