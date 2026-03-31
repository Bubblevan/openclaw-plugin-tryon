# ShowMeTheMoney Demo Backend

This local backend demonstrates the developer-side B chain.

- `GET /execute?agent_did=...`
- backend calls StablePay verify through API Gateway
- if not purchased, returns `402 Payment Required`
- after the client pays, retry returns `200`

## Start

```powershell
cd d:\MyLab\StablePay\stablepay-openclaw-plugin\showmethemoney-skill\demo-backend
npm start
```

## Environment

- `PORT` default `8787`
- `GATEWAY_BASE_URL` default `http://127.0.0.1:8080`
- `STABLEPAY_API_KEY` default `stablepay-dev-key`
- `SKILL_DID` default `did:solana:showmethemoney-demo`
- `SKILL_NAME` default `ShowMeTheMoney`
- `PRICE` default `1.00`
- `CURRENCY` default `USDC`
- `MESSAGE` default `Pay to unlock ShowMeTheMoney`

## Useful routes

- `/healthz`
- `/execute?agent_did=...`
- `/developer/revenue?skill_did=...`
- `/developer/sales?skill_did=...`
- `/agent/balance?agent_did=...`
- `/agent/transactions?agent_did=...`

## Recommended OpenClaw demo

1. create a local wallet in the StablePay plugin
2. register the local DID through `POST /api/v1/did/register`
3. configure payment limits
4. call `stablepay_execute_paid_skill_demo`

The plugin will:

- call `/execute`
- receive `402 Payment Required`
- sign the StablePay pay request locally
- submit `POST /api/v1/pay`
- retry `/execute` until the purchase is visible through Verification
