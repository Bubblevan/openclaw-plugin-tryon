import { StablePayRuntime } from "../dist/runtime.js";
import { getPluginConfig } from "../dist/config.js";

const fakeApi = {
  pluginConfig: {
    backendBaseUrl: "http://127.0.0.1:28080",
    feePayerSolanaAddress: process.env.STABLEPAY_FEE_PAYER_SOL || "",
    owsRuntime: "auto",
  },
};

const cfg = getPluginConfig(fakeApi);
const rt = new StablePayRuntime(cfg);
const status = await rt.getStatus();

console.log(JSON.stringify(status, null, 2));