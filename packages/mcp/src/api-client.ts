export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface Envelope<T> {
  data: T;
  pagination?: Pagination;
}

export type QueryParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export const buildUrl = (
  baseUrl: string,
  path: string,
  query?: QueryParams
): string => {
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(base + p);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
};

interface RawEnvelope {
  success?: boolean;
  data?: unknown;
  pagination?: Pagination;
  error?: { message?: string };
}

export class HybcApiClient {
  private readonly baseUrl: string;
  private readonly token: string | null;

  constructor(baseUrl: string, token: string | null) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async get<T>(path: string, query?: QueryParams): Promise<Envelope<T>> {
    return this.request<T>("GET", path, query);
  }

  async post<T>(path: string, body?: unknown, query?: QueryParams): Promise<Envelope<T>> {
    return this.request<T>("POST", path, query, body ?? {});
  }

  private async request<T>(
    method: string,
    path: string,
    query?: QueryParams,
    body?: unknown
  ): Promise<Envelope<T>> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const fullPath = normalizedPath.startsWith("/api/")
      ? normalizedPath
      : `/api/v1${normalizedPath}`;
    const url = buildUrl(this.baseUrl, fullPath, query);
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    let json: RawEnvelope | null = null;
    try {
      json = (await res.json()) as RawEnvelope;
    } catch {
      json = null;
    }

    if (!res.ok || json?.success === false) {
      const message = json?.error?.message || `HTTP ${res.status}`;
      throw new ApiError(message, res.status);
    }

    return { data: json?.data as T, pagination: json?.pagination };
  }
}
