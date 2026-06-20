$ErrorActionPreference = 'Stop'

param(
  [string]$Server = "root@144.91.92.70",
  [string]$RemoteDir = "/opt/sistema-inscricoes-corridas"
)

Write-Host "This script is a local helper. Copy the repository to the server, then run the bootstrap commands there."
