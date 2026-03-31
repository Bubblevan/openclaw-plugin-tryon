export type RuntimeDriver = "auto" | "ows-sdk" | "ows-cli" | "wsl-ows" | "local-dev";

export type PluginConfig = {
  backendBaseUrl: string;
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
  allowLegacyDidCreateFallback?: boolean;
};

export type RequestHeaders = Record<string, string>;

export type CreateWalletParams = {
  did?: string;
  wallet_address?: string;
};

export type CreateLocalWalletParams = {
  user_id?: string;
  user_type?: "agent" | "developer";
  wallet_name?: string;
  runtime?: Exclude<RuntimeDriver, "auto">;
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

export type ExecutePaidSkillDemoParams = {
  execute_url?: string;
  retry_attempts?: number;
  retry_delay_ms?: number;
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
