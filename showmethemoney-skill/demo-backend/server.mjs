import { createServer } from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8080";
const STABLEPAY_API_KEY = process.env.STABLEPAY_API_KEY || "stablepay-dev-key";
const SKILL_DID = process.env.SKILL_DID || "did:solana:showmethemoney-demo";
const SKILL_NAME = process.env.SKILL_NAME || "ShowMeTheMoney";
const PRICE = process.env.PRICE || "1.00";
const CURRENCY = process.env.CURRENCY || "USDC";
const MESSAGE = process.env.MESSAGE || "Pay to unlock ShowMeTheMoney";

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function writeJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

async function fetchVerify(agentDid) {
  const url = new URL("/api/v1/verify", GATEWAY_BASE_URL);
  url.searchParams.set("agent_did", agentDid);
  url.searchParams.set("skill_did", SKILL_DID);
  const response = await fetch(url, {
    headers: {
      "X-API-Key": STABLEPAY_API_KEY,
    },
  });
  return { status: response.status, body: await readJson(response) };
}

async function fetchPayRequirement(agentDid) {
  const url = new URL("/api/v1/pay/require", GATEWAY_BASE_URL);
  url.searchParams.set("skill_did", SKILL_DID);
  url.searchParams.set("agent_did", agentDid);
  url.searchParams.set("skill_name", SKILL_NAME);
  url.searchParams.set("price", PRICE);
  url.searchParams.set("currency", CURRENCY);
  url.searchParams.set("message", MESSAGE);
  const response = await fetch(url);
  return { status: response.status, body: await readJson(response) };
}

async function fetchRevenue(skillDid) {
  const url = new URL("http://127.0.0.1:8184/internal/revenue");
  url.searchParams.set("skill_did", skillDid || SKILL_DID);
  const response = await fetch(url);
  return { status: response.status, body: await readJson(response) };
}

async function fetchSales(skillDid) {
  const url = new URL("http://127.0.0.1:8184/internal/sales");
  url.searchParams.set("skill_did", skillDid || SKILL_DID);
  const response = await fetch(url);
  return { status: response.status, body: await readJson(response) };
}

async function fetchAgentTransactions(agentDid) {
  const url = new URL("http://127.0.0.1:8184/internal/transactions");
  url.searchParams.set("did", agentDid);
  url.searchParams.set("type", "1");
  const response = await fetch(url);
  return { status: response.status, body: await readJson(response) };
}

async function fetchAgentBalance(agentDid) {
  const url = new URL("http://127.0.0.1:8184/internal/balance");
  url.searchParams.set("agent_did", agentDid);
  const response = await fetch(url);
  return { status: response.status, body: await readJson(response) };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${PORT}`}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      writeJson(res, 200, { ok: true, service: "showmethemoney-demo-backend" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/execute") {
      const agentDid = url.searchParams.get("agent_did");
      if (!agentDid) {
        writeJson(res, 400, { code: "missing_param", message: "agent_did is required" });
        return;
      }

      const verify = await fetchVerify(agentDid);
      if (verify.status >= 400) {
        writeJson(res, 502, { code: "verify_failed", verify });
        return;
      }

      if (verify.body?.data?.purchased || verify.body?.purchased) {
        writeJson(res, 200, {
          ok: true,
          protected_result: "Show me the money: access granted",
          agent_did: agentDid,
          skill_did: SKILL_DID,
          verify,
        });
        return;
      }

      const requirement = await fetchPayRequirement(agentDid);
      writeJson(res, 402, {
        code: 402,
        message: "Payment Required",
        agent_did: agentDid,
        skill_did: SKILL_DID,
        verify,
        payment_requirement: requirement.body,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/developer/revenue") {
      const result = await fetchRevenue(url.searchParams.get("skill_did"));
      writeJson(res, result.status, result.body);
      return;
    }

    if (req.method === "GET" && url.pathname === "/developer/sales") {
      const result = await fetchSales(url.searchParams.get("skill_did"));
      writeJson(res, result.status, result.body);
      return;
    }

    if (req.method === "GET" && url.pathname === "/agent/balance") {
      const agentDid = url.searchParams.get("agent_did");
      if (!agentDid) {
        writeJson(res, 400, { code: "missing_param", message: "agent_did is required" });
        return;
      }
      const result = await fetchAgentBalance(agentDid);
      writeJson(res, result.status, result.body);
      return;
    }

    if (req.method === "GET" && url.pathname === "/agent/transactions") {
      const agentDid = url.searchParams.get("agent_did");
      if (!agentDid) {
        writeJson(res, 400, { code: "missing_param", message: "agent_did is required" });
        return;
      }
      const result = await fetchAgentTransactions(agentDid);
      writeJson(res, result.status, result.body);
      return;
    }

    writeJson(res, 404, { code: "not_found", message: "route not found" });
  } catch (error) {
    writeJson(res, 500, {
      code: "demo_backend_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, () => {
  console.log(`showmethemoney demo backend listening on http://127.0.0.1:${PORT}`);
});
