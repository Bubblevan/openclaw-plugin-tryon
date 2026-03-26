import type {
  BalanceResponse,
  DIDRecord,
  ErrorResponse,
  PluginConfig,
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

  async createMockDid(input: { did: string; wallet_address: string }): Promise<DIDRecord> {
    return this.post<DIDRecord>("/api/v1/mock/dids", input);
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

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.requestTimeoutMs);

    try {
      const response = await fetch(`${this.cfg.backendBaseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = text ? safeJsonParse(text) : undefined;

      if (!response.ok) {
        const errPayload = payload as Partial<ErrorResponse> | undefined;
        throw new StablePayHttpError(
          errPayload?.message || `Request failed with status ${response.status}`,
          response.status,
          payload,
        );
      }

      return payload as T;
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

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
