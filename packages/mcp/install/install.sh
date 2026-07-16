#!/bin/sh
set -eu
HYBC_API="__HYBC_API__"
HYBC_BOOT="__HYBC_BOOT__"
HYBC_AGENT="__HYBC_AGENT__"
export HYBC_API HYBC_BOOT HYBC_AGENT

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js (>=18)。请先安装 https://nodejs.org 再重试。" >&2
  exit 1
fi

MCP_DIR="$HOME/.hybc/mcp"
mkdir -p "$MCP_DIR"

echo "下载 MCP..." >&2
curl -fsSL "$HYBC_API/api/v1/agent/dist/hybc-mcp.mjs" -o "$MCP_DIR/hybc-mcp.mjs"
curl -fsSL "$HYBC_API/api/v1/agent/dist/SKILL.md" -o "$MCP_DIR/SKILL.md" || true

echo "兑换授权..." >&2
RESP=$(curl -fsSL -X POST "$HYBC_API/api/v1/agent/setup/redeem" \
  -H "content-type: application/json" -d "{\"boot_code\":\"$HYBC_BOOT\"}")

printf '%s' "$RESP" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j;try{j=JSON.parse(s)}catch(e){console.error("兑换响应解析失败");process.exit(1)}
  if(!j.success){console.error((j.error&&j.error.message)||"兑换失败");process.exit(1)}
  const d=j.data,fs=require("fs"),os=require("os"),path=require("path");
  const p=path.join(os.homedir(),".hybc","credentials.json");
  fs.writeFileSync(p,JSON.stringify({baseUrl:process.env.HYBC_API,token:d.agent_token,wecomUserid:d.wecom_userid,role:d.role,savedAt:new Date().toISOString()},null,2),{mode:0o600});
  fs.chmodSync(p,0o600);
  console.error("已保存凭证："+d.wecom_userid+"（"+d.role+"）");
});'

case "$HYBC_AGENT" in
  claude_code)
    SKILL_DIR="$HOME/.claude/skills/hybc"; mkdir -p "$SKILL_DIR"
    cp "$MCP_DIR/SKILL.md" "$SKILL_DIR/SKILL.md" 2>/dev/null || true
    if command -v claude >/dev/null 2>&1; then
      claude mcp add --scope user hybc -- node "$MCP_DIR/hybc-mcp.mjs" serve >/dev/null 2>&1 || true
      echo "已配置 Claude Code。" >&2
    else
      echo "未找到 claude 命令，MCP 未自动注册。请在终端手动执行：" >&2
      echo "  claude mcp add --scope user hybc -- node \"$MCP_DIR/hybc-mcp.mjs\" serve" >&2
    fi ;;
  codex)
    mkdir -p "$HOME/.codex"; CFG="$HOME/.codex/config.toml"
    if ! grep -q "\[mcp_servers.hybc\]" "$CFG" 2>/dev/null; then
      printf '\n[mcp_servers.hybc]\ncommand = "node"\nargs = ["%s", "serve"]\n' "$MCP_DIR/hybc-mcp.mjs" >> "$CFG"
    fi
    echo "已配置 Codex。" >&2 ;;
  *)
    echo "请在你的 agent 里手动配置 MCP：command=node，args=[\"$MCP_DIR/hybc-mcp.mjs\",\"serve\"]" >&2 ;;
esac

echo "完成。可在 agent 中使用恒越百川只读工具了。" >&2
