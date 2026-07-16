import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearCredentials, readCredentials, saveCredentials } from "./credentials";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hybc-mcp-"));
  path = join(dir, "credentials.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("credentials", () => {
  it("returns null when file is absent", async () => {
    expect(await readCredentials(path)).toBeNull();
  });

  it("round-trips and writes 0600 perms", async () => {
    const creds = {
      baseUrl: "https://api.hybcdg.com",
      token: "hybc_agent_abc",
      wecomUserid: "MaxLiu",
      role: "finance",
      savedAt: "2026-07-16T00:00:00.000Z"
    };
    await saveCredentials(creds, path);
    const back = await readCredentials(path);
    expect(back).toEqual(creds);
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("clear removes the file (idempotent)", async () => {
    await saveCredentials(
      {
        baseUrl: "b",
        token: "t",
        wecomUserid: "u",
        role: "operator",
        savedAt: "s"
      },
      path
    );
    await clearCredentials(path);
    expect(await readCredentials(path)).toBeNull();
    await clearCredentials(path); // no throw on missing
  });
});
