import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveCredentialsPath } from "./config.js";

export interface StoredCredentials {
  baseUrl: string;
  token: string;
  wecomUserid: string;
  role: string;
  savedAt: string;
}

export const readCredentials = async (
  path: string = resolveCredentialsPath()
): Promise<StoredCredentials | null> => {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
};

export const saveCredentials = async (
  creds: StoredCredentials,
  path: string = resolveCredentialsPath()
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
};

export const clearCredentials = async (
  path: string = resolveCredentialsPath()
): Promise<void> => {
  await rm(path, { force: true });
};
