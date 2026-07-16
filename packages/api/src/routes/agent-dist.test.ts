import { describe, expect, it } from "vitest";

import { agentRoutes } from "./agent";
import type { Env } from "../types/env";

const fakeR2 = (files: Record<string, string>) =>
  ({
    async get(key: string) {
      if (!(key in files)) return null;
      return {
        body: files[key],
        httpEtag: '"etag"',
        writeHttpMetadata: () => undefined,
        async text() {
          return files[key];
        }
      };
    }
  }) as unknown as Env["FILES"];

const fakeEnv = (over: Partial<Env> = {}): Env =>
  ({
    AGENT_API_BASE_URL: "https://api.hybcdg.com",
    AGENT_WEB_BASE_URL: "https://web.hybcdg.com",
    FILES: fakeR2({ "agent-dist/hybc-mcp.mjs": "#!/usr/bin/env node\nconsole.log(1)" }),
    DB: {} as unknown as Env["DB"],
    KV: {} as unknown as Env["KV"],
    ...over
  }) as unknown as Env;

describe("agent dist + install routes", () => {
  it("GET /dist/hybc-mcp.mjs streams the R2 object", async () => {
    const res = await agentRoutes.request("/dist/hybc-mcp.mjs", {}, fakeEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("#!/usr/bin/env node");
  });

  it("GET /dist/:file 404s for a missing object", async () => {
    const res = await agentRoutes.request("/dist/nope.txt", {}, fakeEnv());
    expect(res.status).toBe(404);
  });

  it("GET /dist/:file rejects path traversal / unknown names", async () => {
    const res = await agentRoutes.request("/dist/..%2f..%2fsecret", {}, fakeEnv());
    expect([400, 404]).toContain(res.status);
  });

  it("GET /install.sh renders the R2 template with validated boot", async () => {
    const env = fakeEnv({
      FILES: fakeR2({
        "agent-dist/install.sh":
          'HYBC_API="__HYBC_API__"\nHYBC_BOOT="__HYBC_BOOT__"\nHYBC_AGENT="__HYBC_AGENT__"\ncurl "__HYBC_API__/api/v1/agent/setup/redeem"\n'
      })
    });
    const res = await agentRoutes.request(
      "/install.sh?boot=123e4567-e89b-12d3-a456-426614174000&agent=claude_code",
      {},
      env
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('HYBC_BOOT="123e4567-e89b-12d3-a456-426614174000"');
    expect(body).toContain("/api/v1/agent/setup/redeem");
    expect(body).not.toContain("__HYBC_");
  });

  it("GET /install.sh with a malicious boot yields empty boot (no injection)", async () => {
    const env = fakeEnv({
      FILES: fakeR2({
        "agent-dist/install.sh": 'HYBC_BOOT="__HYBC_BOOT__"\n'
      })
    });
    const res = await agentRoutes.request(
      "/install.sh?boot=x%22%3B%20rm%20-rf%20~%20%3B%20%22",
      {},
      env
    );
    const body = await res.text();
    expect(body).toContain('HYBC_BOOT=""');
    expect(body).not.toContain("rm -rf");
  });

  it("GET /install.sh 404s when the template is not published", async () => {
    const res = await agentRoutes.request("/install.sh?boot=&agent=other", {}, fakeEnv());
    expect(res.status).toBe(404);
  });
});
