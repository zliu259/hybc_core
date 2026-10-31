#!/usr/bin/env python3
"""web.hybcdg.com 入口的 DNS 切换 / 回滚助手（Cloudflare API，只读 token 文件，不打印 token）。

网页端整站镜像（2026-10-31）把 `web.hybcdg.com` 从 Cloudflare 橙云 CNAME 改为灰云 A/AAAA 直出东京 VM；
本脚本封装了那次切换与回滚用到的四个动作。令牌默认读 `~/.hybc/cf-dns-token`（Zone:Read + DNS:Edit，
限 hybcdg.com；与 GitHub secret AZURE_BRIDGE_CF_DNS_API_TOKEN 同值），可用环境变量 CF_DNS_TOKEN_FILE 覆盖。

用法（在仓库任意位置执行）：
  python3 -I scripts/deploy/cf-dns.py verify                      # token 状态、zone 可读、记录可见
  python3 -I scripts/deploy/cf-dns.py show web.hybcdg.com         # 列出记录
  python3 -I scripts/deploy/cf-dns.py cutover web.hybcdg.com 13.114.172.128 2406:da14:33e:c700:7141:8509:bd15:77bc
      # 把现有 CNAME/A 原地改为灰云 A（TTL 300），缺 AAAA 则补一条
  python3 -I scripts/deploy/cf-dns.py rollback web.hybcdg.com hybc-core.pages.dev
      # 删掉 AAAA，把 A/CNAME 改回橙云 CNAME（Pages 自定义域名需几分钟重新激活，绑定须一直保留）

依赖：仅 Python 3.11+ 标准库。切换后用 `dig @1.1.1.1 web.hybcdg.com` 与 `curl -sI https://web.hybcdg.com/` 复核。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

ZONE_ID = "a1b20d98dbed6a52bcf1adc44b5863f6"  # hybcdg.com
API = "https://api.cloudflare.com/client/v4"
TOKEN_FILE = os.environ.get("CF_DNS_TOKEN_FILE", os.path.expanduser("~/.hybc/cf-dns-token"))
CUTOVER_COMMENT = "web mirror: DNS-only to Tokyo VM (Caddy -> Pages origin)"
ROLLBACK_COMMENT = "rolled back to Cloudflare Pages"


def read_token() -> str:
    try:
        with open(TOKEN_FILE, encoding="utf-8") as fh:
            value = fh.read().strip()
    except OSError as exc:
        sys.exit(f"cannot read token file {TOKEN_FILE}: {exc}")
    if len(value) < 40 or any(ch.isspace() for ch in value):
        sys.exit(f"token file {TOKEN_FILE} does not look like a Cloudflare API token ({len(value)} chars)")
    return value


def call(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {read_token()}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as exc:
        payload = json.loads(exc.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError) as exc:
        sys.exit(f"network error calling Cloudflare API: {exc}")
    if not payload.get("success"):
        sys.exit("Cloudflare API error: " + json.dumps(payload.get("errors"), ensure_ascii=False))
    return payload


def records(name: str) -> list[dict]:
    return call("GET", f"/zones/{ZONE_ID}/dns_records?name={name}")["result"]


def fmt(rec: dict) -> str:
    return f"{rec['id']} {rec['type']:5} {rec['name']} -> {rec['content']} proxied={rec['proxied']} ttl={rec['ttl']}"


def print_records(label: str, recs: list[dict]) -> None:
    print(f"{label}:")
    for rec in recs:
        print(" ", fmt(rec))


def cmd_verify() -> None:
    info = call("GET", "/user/tokens/verify")["result"]
    print("token status:", info.get("status"), "expires:", info.get("expires_on"))
    zone = call("GET", f"/zones/{ZONE_ID}")["result"]
    print("zone read ok:", zone["name"])
    visible = call("GET", f"/zones/{ZONE_ID}/dns_records?per_page=5")["result"]
    print("dns records visible:", len(visible) > 0)


def cmd_cutover(name: str, a_ip: str, aaaa_ip: str) -> None:
    existing = records(name)
    print_records("before", existing)
    primary = next((r for r in existing if r["type"] in ("CNAME", "A")), None)
    if primary is None:
        sys.exit("no CNAME/A record to replace")
    updated = call(
        "PUT",
        f"/zones/{ZONE_ID}/dns_records/{primary['id']}",
        {"type": "A", "name": name, "content": a_ip, "proxied": False, "ttl": 300, "comment": CUTOVER_COMMENT},
    )["result"]
    print("updated:", fmt(updated))
    if not any(r["type"] == "AAAA" for r in existing):
        created = call(
            "POST",
            f"/zones/{ZONE_ID}/dns_records",
            {"type": "AAAA", "name": name, "content": aaaa_ip, "proxied": False, "ttl": 300, "comment": CUTOVER_COMMENT},
        )["result"]
        print("created:", fmt(created))
    print_records("after", records(name))


def cmd_rollback(name: str, target: str) -> None:
    existing = records(name)
    print_records("before", existing)
    for rec in existing:
        if rec["type"] == "AAAA":
            call("DELETE", f"/zones/{ZONE_ID}/dns_records/{rec['id']}")
            print("deleted AAAA", rec["id"])
    primary = next((r for r in existing if r["type"] in ("A", "CNAME")), None)
    if primary is None:
        sys.exit("no A/CNAME record to restore")
    restored = call(
        "PUT",
        f"/zones/{ZONE_ID}/dns_records/{primary['id']}",
        {"type": "CNAME", "name": name, "content": target, "proxied": True, "ttl": 1, "comment": ROLLBACK_COMMENT},
    )["result"]
    print("restored:", fmt(restored))


def main(argv: list[str]) -> None:
    cmd = argv[1] if len(argv) > 1 else "verify"
    try:
        if cmd == "verify":
            cmd_verify()
        elif cmd == "show":
            print_records(argv[2], records(argv[2]))
        elif cmd == "cutover":
            cmd_cutover(argv[2], argv[3], argv[4])
        elif cmd == "rollback":
            cmd_rollback(argv[2], argv[3])
        else:
            print(__doc__)
            sys.exit(2)
    except IndexError:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main(sys.argv)
