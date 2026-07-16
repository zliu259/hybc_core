// publish-dist.mjs — 打 bundle 并上传到 R2 (agent-dist/)。owner 手动运行。
// 用法: node scripts/publish-dist.mjs [mcpDir] [--dry-run]
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

const args = process.argv.slice(2).filter((a) => a !== "--dry-run");
const dryRun = process.argv.includes("--dry-run");
const mcpDir = resolve(args[0] ?? ".");
const bundle = resolve(mcpDir, "dist/hybc-mcp.mjs");
const skill = resolve(mcpDir, "SKILL.md");
const installSh = resolve(mcpDir, "install/install.sh");
const installPs1 = resolve(mcpDir, "install/install.ps1");
const bucket = "hybcdg-prod-files";

run(`cd "${mcpDir}" && npm run build:bundle`);
if (!existsSync(bundle)) {
  console.error("bundle 未生成:", bundle);
  process.exit(1);
}

const put = (localPath, key) => {
  if (!existsSync(localPath)) {
    console.error("缺少文件:", localPath);
    process.exit(1);
  }
  const cmd = `npx wrangler r2 object put "${bucket}/${key}" --file "${localPath}" --remote`;
  if (dryRun) {
    console.log("[dry-run]", cmd);
  } else {
    run(cmd);
  }
};

put(bundle, "agent-dist/hybc-mcp.mjs");
put(skill, "agent-dist/SKILL.md");
put(installSh, "agent-dist/install.sh");
put(installPs1, "agent-dist/install.ps1");
console.log(dryRun ? "dry-run 完成" : "已发布到 R2 agent-dist/");
