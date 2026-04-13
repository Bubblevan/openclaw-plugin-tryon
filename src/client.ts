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
      wallet_name?: string;
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
    return this.request<VerifyStatusResponse>("GET", `/verify?did=${encodeURIComponent(did)}`);
  }

  /**
   * GET /api/v1/balance. When api-gateway route uses auth "did", pass signed headers (see buildGatewayDidAuthHeaders).
   */
  async getBalance(
    did: string,
    gatewayAuthHeaders: (path: string, rawQuery: string) => Promise<RequestHeaders>,
  ): Promise<BalanceResponse> {
    const path = "/api/v1/balance";
    const attempts = [`agent_did=${encodeURIComponent(did)}`, `agent=${encodeURIComponent(did)}`];
    let lastError: unknown;
    for (let i = 0; i < attempts.length; i++) {
      try {
        const rawQuery = attempts[i];
        const headers = await gatewayAuthHeaders(path, rawQuery);
        return await this.request<BalanceResponse>("GET", `${path}?${rawQuery}`, undefined, headers);
      } catch (error) {
        lastError = error;
        if (i === 0 && error instanceof StablePayHttpError && error.status === 400) {
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  async executeDemoSkill(executeUrl: string, agentDid: string): Promise<{ status: number; body: any }> {
    const target = new URL(executeUrl);
    target.searchParams.set("agent_did", agentDid);
    const result = await this.rawRequest("GET", target.toString(), undefined, undefined, [402]);
    return { status: result.status, body: result.payload };
  }

  async initiatePayment(body: Record<string, unknown>, headers: RequestHeaders): Promise<any> {
    return this.request<any>("POST", "/api/v1/pay", body, headers);
  }

  /** POST with pre-serialized JSON (stable SHA256 for gateway canonical). */
  async postJsonRaw(path: string, rawJsonBody: string, headers?: RequestHeaders): Promise<any> {
    const { payload } = await this.rawRequest("POST", path, rawJsonBody, headers);
    const obj = payload as any;
    if (obj && typeof obj === "object" && "data" in obj) {
      return obj.data as any;
    }
    return payload as any;
  }

  async fetchPayRequire(params: {
    skill_did: string;
    agent_did: string;
    skill_name: string;
    price: string;
    currency: string;
    message?: string;
  }): Promise<{ status: number; payload: unknown }> {
    const q = new URLSearchParams({
      skill_did: params.skill_did,
      agent_did: params.agent_did,
      skill_name: params.skill_name,
      price: params.price,
      currency: params.currency,
    });
    if (params.message) q.set("message", params.message);
    const { status, payload } = await this.rawRequest(
      "GET",
      `/api/v1/pay/require?${q.toString()}`,
      undefined,
      undefined,
      [200, 402],
    );
    return { status, payload };
  }

  async getSales(
    skillDid: string,
    gatewayAuthHeaders: (path: string, rawQuery: string) => Promise<RequestHeaders>,
  ): Promise<any> {
    const path = "/api/v1/sales";
    const rawQuery = `skill_did=${encodeURIComponent(skillDid)}`;
    const headers = await gatewayAuthHeaders(path, rawQuery);
    return this.request<any>("GET", `${path}?${rawQuery}`, undefined, headers);
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
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
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


