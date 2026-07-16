import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://api.hybcdg.com";

export const resolveBaseUrl = (stored?: string): string =>
  process.env.HYBC_API_BASE_URL?.trim() || stored?.trim() || DEFAULT_BASE_URL;

export const resolveCredentialsPath = (): string =>
  process.env.HYBC_CREDENTIALS_PATH?.trim() || join(homedir(), ".hybc", "credentials.json");
