$ErrorActionPreference = 'Stop'

param(
  [string]$Server = "root@2.25.150.248",
  [string]$RemoteDir = "/opt/sistema-inscricoes-corridas"
)

Write-Host "This script is a local helper. Copy the repository to the server, then run the bootstrap commands there."
