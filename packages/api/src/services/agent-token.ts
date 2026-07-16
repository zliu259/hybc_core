export const AGENT_TOKEN_PREFIX = "hybc_agent_";

export const isAgentToken = (token: string): boolean =>
  token.startsWith(AGENT_TOKEN_PREFIX);

export const generateAgentToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const body = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${AGENT_TOKEN_PREFIX}${body}`;
};

export const hashAgentToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const tokenPrefixForDisplay = (token: string): string =>
  `${token.slice(0, AGENT_TOKEN_PREFIX.length + 6)}…`;
