$ErrorActionPreference = "Stop"
$HYBC_API = "__HYBC_API__"
$HYBC_BOOT = "__HYBC_BOOT__"
$HYBC_AGENT = "__HYBC_AGENT__"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "需要 Node.js (>=18)。请先安装 https://nodejs.org 再重试。"; exit 1
}

$McpDir = Join-Path $HOME ".hybc/mcp"
New-Item -ItemType Directory -Force -Path $McpDir | Out-Null

Write-Host "下载 MCP..."
Invoke-WebRequest -UseBasicParsing "$HYBC_API/api/v1/agent/dist/hybc-mcp.mjs" -OutFile (Join-Path $McpDir "hybc-mcp.mjs")
try { Invoke-WebRequest -UseBasicParsing "$HYBC_API/api/v1/agent/dist/SKILL.md" -OutFile (Join-Path $McpDir "SKILL.md") } catch {}

Write-Host "兑换授权..."
$resp = Invoke-RestMethod -Method Post "$HYBC_API/api/v1/agent/setup/redeem" -ContentType "application/json" -Body (@{ boot_code = $HYBC_BOOT } | ConvertTo-Json)
if (-not $resp.success) { Write-Error ($resp.error.message); exit 1 }
$d = $resp.data
$cred = @{ baseUrl = $HYBC_API; token = $d.agent_token; wecomUserid = $d.wecom_userid; role = $d.role; savedAt = (Get-Date).ToUniversalTime().ToString("o") }
$credPath = Join-Path $HOME ".hybc/credentials.json"
$cred | ConvertTo-Json | Set-Content -Path $credPath -Encoding utf8
Write-Host "已保存凭证：$($d.wecom_userid)（$($d.role)）"

$mjs = Join-Path $McpDir "hybc-mcp.mjs"
switch ($HYBC_AGENT) {
  "claude_code" {
    $skillDir = Join-Path $HOME ".claude/skills/hybc"; New-Item -ItemType Directory -Force -Path $skillDir | Out-Null
    Copy-Item (Join-Path $McpDir "SKILL.md") (Join-Path $skillDir "SKILL.md") -ErrorAction SilentlyContinue
    if (Get-Command claude -ErrorAction SilentlyContinue) {
      claude mcp add --scope user hybc -- node "$mjs" serve 2>$null
      Write-Host "已配置 Claude Code。"
    } else {
      Write-Host "未找到 claude 命令，MCP 未自动注册。请在终端手动执行："
      Write-Host "  claude mcp add --scope user hybc -- node `"$mjs`" serve"
    }
  }
  "codex" {
    $codex = Join-Path $HOME ".codex"; New-Item -ItemType Directory -Force -Path $codex | Out-Null
    $cfg = Join-Path $codex "config.toml"
    if (-not (Select-String -Path $cfg -Pattern "\[mcp_servers.hybc\]" -ErrorAction SilentlyContinue)) {
      Add-Content -Path $cfg -Value "`n[mcp_servers.hybc]`ncommand = `"node`"`nargs = [`"$mjs`", `"serve`"]`n"
    }
    Write-Host "已配置 Codex。"
  }
  default { Write-Host "请手动配置 MCP：command=node，args=[`"$mjs`",`"serve`"]" }
}
Write-Host "完成。"
