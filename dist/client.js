export class StablePayHttpError extends Error {
    status;
    payload;
    constructor(message, status, payload) {
        super(message);
        this.name = "StablePayHttpError";
        this.status = status;
        this.payload = payload;
    }
}
export class StablePayClient {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async registerLocalDid(input, pathOverride) {
        return this.post(pathOverride || this.cfg.didRegisterPath, input);
    }
    async seedMockTweet(input) {
        return this.post("/api/v1/mock/twitter/tweets", input);
    }
    async verifyTwitter(input) {
        return this.post("/verify-twitter", input);
    }
    async getVerifyStatus(did) {
        return this.get(`/verify?did=${encodeURIComponent(did)}`);
    }
    async getBalance(did) {
        try {
            // Newer gateway contract.
            return await this.get(`/api/v1/balance?agent_did=${encodeURIComponent(did)}`);
        }
        catch (error) {
            if (!(error instanceof StablePayHttpError) || error.status !== 400) {
                throw error;
            }
            // Backward-compat fallback for older deployments.
            return this.get(`/api/v1/balance?agent=${encodeURIComponent(did)}`);
        }
    }
    async executeDemoSkill(executeUrl, agentDid) {
        const target = new URL(executeUrl);
        target.searchParams.set("agent_did", agentDid);
        const result = await this.rawRequest("GET", target.toString(), undefined, undefined, [402]);
        return { status: result.status, body: result.payload };
    }
    async initiatePayment(body, headers) {
        return this.request("POST", "/api/v1/pay", body, headers);
    }
    /** POST with pre-serialized JSON (stable SHA256 for gateway canonical). */
    async postJsonRaw(path, rawJsonBody, headers) {
        const { payload } = await this.rawRequest("POST", path, rawJsonBody, headers);
        const obj = payload;
        if (obj && typeof obj === "object" && "data" in obj) {
            return obj.data;
        }
        return payload;
    }
    async fetchPayRequire(params) {
        const q = new URLSearchParams({
            skill_did: params.skill_did,
            agent_did: params.agent_did,
            skill_name: params.skill_name,
            price: params.price,
            currency: params.currency,
        });
        if (params.message)
            q.set("message", params.message);
        const { status, payload } = await this.rawRequest("GET", `/api/v1/pay/require?${q.toString()}`, undefined, undefined, [200, 402]);
        return { status, payload };
    }
    async getSales(skillDid, headers) {
        return this.request("GET", `/api/v1/sales?skill_did=${encodeURIComponent(skillDid)}`, undefined, headers);
    }
    async get(path) {
        return this.request("GET", path);
    }
    async post(path, body, headers) {
        return this.request("POST", path, body, headers);
    }
    async request(method, path, body, headers) {
        const { payload } = await this.rawRequest(method, path, body, headers);
        const obj = payload;
        if (obj && typeof obj === "object" && "data" in obj) {
            return obj.data;
        }
        return payload;
    }
    async rawRequest(method, path, body, headers, allowStatuses = []) {
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
                const errPayload = payload;
                throw new StablePayHttpError(errPayload?.message || `Request failed with status ${response.status}`, response.status, payload);
            }
            return { status: response.status, payload };
        }
        catch (error) {
            if (error instanceof StablePayHttpError) {
                throw error;
            }
            if (error instanceof Error && error.name === "AbortError") {
                throw new StablePayHttpError("Request timed out", 408);
            }
            throw new StablePayHttpError(error instanceof Error ? error.message : "Unknown request error", 500);
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
function resolveTarget(baseUrl, path) {
    if (/^https?:\/\//i.test(path)) {
        return path;
    }
    return `${baseUrl}${path}`;
}
function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return { raw: text };
    }
}
