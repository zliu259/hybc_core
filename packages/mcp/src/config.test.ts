import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_BASE_URL, resolveBaseUrl, resolveCredentialsPath } from "./config";

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("config", () => {
  it("prefers HYBC_API_BASE_URL env, then stored, then default", () => {
    delete process.env.HYBC_API_BASE_URL;
    expect(resolveBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(resolveBaseUrl("https://stored.example")).toBe("https://stored.example");
    process.env.HYBC_API_BASE_URL = "https://env.example";
    expect(resolveBaseUrl("https://stored.example")).toBe("https://env.example");
  });

  it("credentials path honors HYBC_CREDENTIALS_PATH override", () => {
    delete process.env.HYBC_CREDENTIALS_PATH;
    expect(resolveCredentialsPath().endsWith("/.hybc/credentials.json")).toBe(true);
    process.env.HYBC_CREDENTIALS_PATH = "/tmp/creds.json";
    expect(resolveCredentialsPath()).toBe("/tmp/creds.json");
  });
});
