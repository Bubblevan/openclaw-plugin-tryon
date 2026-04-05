import type {
  BalanceResponse,
  DIDRecord,
  ErrorResponse,
  PluginConfig,
  RequestHeaders,
  VerifyStatusResponse,
  VerifyTwitterResponse,
} from "./types.js";

export class StablePayHttpError extends Error {
  readonly status: number;
  readonly payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "StablePayHttpError";
    this.status = status;
    this.payload = payload;
  }
}

export class StablePayClient {
  constructor(private readonly cfg: Required<PluginConfig>) {}

  async registerLocalDid(
    input: {
      user_type: string;
      public_key: string;
      wallet_address: string;
      wallet_id?: string;
      metadata?: Record<string, string>;
    },
    pathOverride?: string,
  ): Promise<DIDRecord> {
    return this.post<DIDRecord>(pathOverride || this.cfg.didRegisterPath, input);
  }

  async seedMockTweet(input: {
    tweet_url: string;
    text: string;
    is_public: boolean;
  }): Promise<unknown> {
    return this.post<unknown>("/api/v1/mock/twitter/tweets", input);
  }

  async verifyTwitter(input: { did: string; tweet_url: string }): Promise<VerifyTwitterResponse> {
    return this.post<VerifyTwitterResponse>("/verify-twitter", input);
  }

  async getVerifyStatus(did: string): Promise<VerifyStatusResponse> {
    return this.get<VerifyStatusResponse>(`/verify?did=${encodeURIComponent(did)}`);
  }

  async getBalance(did: string): Promise<BalanceResponse> {
    return this.get<BalanceResponse>(`/api/v1/balance?agent=${encodeURIComponent(did)}`);
  }

  async executeDemoSkill(executeUrl: string, agentDid: string): Promise<{ status: number; body: any }> {
    const target = new URL(executeUrl);
    target.searchParams.set("agent_did", agentDid);
    const result = await this.rawRequest("GET", target.toString(), undefined, undefined, [402]);
    return { status: result.status, body: result.payload };
  }

  async paySigned(body: Record<string, unknown>, headers: RequestHeaders): Promise<any> {
    return this.request<any>("POST", "/api/v1/pay", body, headers);
  }

  async getSales(skillDid: string, headers?: RequestHeaders): Promise<any> {
    return this.request<any>("GET", `/api/v1/sales?skill_did=${encodeURIComponent(skillDid)}`, undefined, headers);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown, headers?: RequestHeaders): Promise<T> {
    return this.request<T>("POST", path, body, headers);
  }

  private async request<T>(method: string, path: string, body?: unknown, headers?: RequestHeaders): Promise<T> {
    const { payload } = await this.rawRequest(method, path, body, headers);
    const obj = payload as any;
    if (obj && typeof obj === "object" && "data" in obj) {
      return obj.data as T;
    }
    return payload as T;
  }

  private async rawRequest(
    method: string,
    path: string,
    body?: unknown,
    headers?: RequestHeaders,
    allowStatuses: number[] = [],
  ): Promise<{ status: number; payload: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.requestTimeoutMs);

    try {
      const response = await fetch(resolveTarget(this.cfg.backendBaseUrl, path), {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(headers ?? {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = text ? safeJsonParse(text) : undefined;

      if (!response.ok && !allowStatuses.includes(response.status)) {
        const errPayload = payload as Partial<ErrorResponse> | undefined;
        throw new StablePayHttpError(
          errPayload?.message || `Request failed with status ${response.status}`,
          response.status,
          payload,
        );
      }

      return { status: response.status, payload };
    } catch (error) {
      if (error instanceof StablePayHttpError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new StablePayHttpError("Request timed out", 408);
      }
      throw new StablePayHttpError(error instanceof Error ? error.message : "Unknown request error", 500);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function resolveTarget(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${baseUrl}${path}`;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}


