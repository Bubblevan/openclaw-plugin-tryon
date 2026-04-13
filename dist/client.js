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
        return this.request("GET", `/verify?did=${encodeURIComponent(did)}`);
    }
    /**
     * GET /api/v1/balance. When api-gateway route uses auth "did", pass signed headers (see buildGatewayDidAuthHeaders).
     */
    async getBalance(did, gatewayAuthHeaders) {
        const path = "/api/v1/balance";
        const attempts = [`agent_did=${encodeURIComponent(did)}`, `agent=${encodeURIComponent(did)}`];
        let lastError;
        for (let i = 0; i < attempts.length; i++) {
            try {
                const rawQuery = attempts[i];
                const headers = await gatewayAuthHeaders(path, rawQuery);
                return await this.request("GET", `${path}?${rawQuery}`, undefined, headers);
            }
            catch (error) {
                lastError = error;
                if (i === 0 && error instanceof StablePayHttpError && error.status === 400) {
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
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
    async getSales(skillDid, gatewayAuthHeaders) {
        const path = "/api/v1/sales";
        const rawQuery = `skill_did=${encodeURIComponent(skillDid)}`;
        const headers = await gatewayAuthHeaders(path, rawQuery);
        return this.request("GET", `${path}?${rawQuery}`, undefined, headers);
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
