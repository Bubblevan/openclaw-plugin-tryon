export type RuntimeDriver = "auto" | "ows-sdk" | "ows-cli" | "wsl-ows" | "ows-rest";

export type OwsRestAuthMode = "bearer" | "x_api_key" | "raw";

export type PluginConfig = {
  backendBaseUrl?: string;
  /** Hotwallet / fee payer Solana address (must match blockchain-adapter). Env: STABLEPAY_FEE_PAYER_SOL */
  feePayerSolanaAddress?: string;
  /** Solana RPC for building SPL transfer (default devnet). */
  solanaRpcUrl?: string;
  /** SPL mint for USDC/USDT leg (default devnet USDC). */
  splTokenMintAddress?: string;
  verifyPageBaseUrl?: string;
  requestTimeoutMs?: number;
  rewardAmount?: number;
  localStatePath?: string;
  localStateKeyEnv?: string;
  owsVaultPath?: string;
  owsPassphraseEnv?: string;
  owsRuntime?: RuntimeDriver;
  walletNamePrefix?: string;
  didRegisterPath?: string;
  /** Base URL of an OWS-compatible local sign HTTP service (Profile C). When set, enables the ows-rest runtime. */
  owsRestBaseUrl?: string;
  /** POST path for signMessage, default /v1/sign/message */
  owsRestSignPath?: string;
  /** Env var holding the API token for ows-rest (default STABLEPAY_OWS_REST_API_KEY) */
  owsRestApiKeyEnv?: string;
  owsRestAuthMode?: OwsRestAuthMode;
  /** Default wallet UUID for ows-rest when not passed at wallet creation */
  owsRestWalletId?: string;
  /** CAIP-2 chain id for Solana (default devnet cluster from OWS examples) */
  owsRestChainId?: string;
  /** Extra verbose logs (ATA, fee payer vs from, signing runtime). Env: STABLEPAY_PLUGIN_DEBUG=1 */
  pluginDebug?: boolean;
};

export type RequestHeaders = Record<string, string>;

export type CreateLocalWalletParams = {
  user_id?: string;
  user_type?: "agent" | "developer";
  wallet_name?: string;
  runtime?: Exclude<RuntimeDriver, "auto">;
  /** Required for ows-cli / wsl-ows / ows-rest: Solana public key (Base58) from `ows wallet list` or similar */
  public_key?: string;
  /** Optional OWS wallet UUID for ows-rest (overrides plugin config owsRestWalletId) */
  ows_wallet_id?: string;
};

export type RegisterLocalDidParams = {
  user_type?: "agent" | "developer";
  register_path?: string;
};

export type ConfigurePaymentLimitsParams = {
  single_purchase_limit_usdc: number;
  auto_purchase_threshold_usdc: number;
  currency?: "USDC" | "USDT";
};

export type BuildPaymentPolicyParams = {
  skill_did?: string;
  recipient_wallet?: string;
  currency?: "USDC" | "USDT";
  purpose?: string;
  expires_at?: string;
  owner_or_agent?: "owner" | "agent";
};

export type SignMessageParams = {
  message: string;
  chain?: string;
  timestamp?: string;
  nonce?: string;
  append_timestamp_nonce?: boolean;
};

export type WalletProviderName = "ows";

export type ExecutePaidSkillDemoParams = {
  execute_url?: string;
  retry_attempts?: number;
  retry_delay_ms?: number;
  /** When true, pay even if price exceeds auto-purchase threshold (still capped by single-purchase limit). */
  confirm_over_threshold?: boolean;
};

export type PayViaGatewayParams = {
  skill_did: string;
  skill_name: string;
  price: string;
  currency?: "USDC" | "USDT";
  message?: string;
  confirm_over_threshold?: boolean;
};

export type SeedTweetParams = {
  tweet_url: string;
  text: string;
  is_public?: boolean;
};

export type VerifyTwitterParams = {
  did: string;
  tweet_url: string;
};

export type BalanceParams = {
  did: string;
};

export type SalesParams = {
  skill_did: string;
};

export type VerifyLinkParams = {
  did: string;
};

export type VerifyStatusParams = {
  did: string;
};

export type DIDRecord = {
  did: string;
  wallet_address: string;
  public_key?: string;
  wallet_id?: string;
  wallet_name?: string;
  created_at?: string;
};

export type VerifyTwitterResponse = {
  success: boolean;
  twitter_handle?: string;
  reward_tx?: string;
  message?: string;
  code?: string;
};

export type VerifyStatusResponse = {
  verified: boolean;
  twitter_handle?: string;
  reward_tx?: string;
};

export type BalanceResponse = {
  balance: number;
  currency: string;
};

export type PaymentRequirementResponse = {
  skill_did: string;
  skill_name?: string;
  price: string;
  currency: "USDC" | "USDT";
  message: string;
  payment_endpoint: string;
};

export type ErrorResponse = {
  success?: false;
  code?: string | number;
  message: string;
};
