export type PluginConfig = {
  backendBaseUrl: string;
  verifyPageBaseUrl?: string;
  requestTimeoutMs?: number;
  rewardAmount?: number;
};

export type CreateWalletParams = {
  did?: string;
  wallet_address?: string;
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

export type ErrorResponse = {
  success: false;
  code: string;
  message: string;
};
