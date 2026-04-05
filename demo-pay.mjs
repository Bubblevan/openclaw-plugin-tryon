import { StablePayRuntime } from './dist/runtime.js';
import { StablePayClient } from './dist/client.js';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_STATE_FILE = path.join(os.homedir(), '.stablepay-openclaw', 'stablepay-local-state.enc');

const cfg = {
  backendBaseUrl: 'http://127.0.0.1:28080',
  verifyPageBaseUrl: 'http://127.0.0.1:3000/verify',
  owsRuntime: 'auto',
  walletNamePrefix: 'stablepay',
  didRegisterPath: '/api/v1/did/register',
  allowLegacyDidCreateFallback: false,
  localStatePath: DEFAULT_STATE_FILE,
  localStateKeyEnv: 'STABLEPAY_PLUGIN_MASTER_KEY',
  owsPassphraseEnv: 'STABLEPAY_OWS_PASSPHRASE',
  owsVaultPath: '',
  requestTimeoutMs: 8000,
  rewardAmount: 1
};

const runtime = new StablePayRuntime(cfg);
const client = new StablePayClient(cfg);

function toMinorUnits(amount) {
  return Math.round(parseFloat(amount) * 100);
}

async function executePaidSkillDemo() {
  console.log('=== 执行付费技能演示 ===');
  console.log('完整流程: verify → 402 → sign → pay → retry → 200');
  console.log('');
  
  // 获取钱包
  const status = await runtime.getStatus();
  const agentDid = status.wallet.did;
  
  console.log('Agent DID:', agentDid);
  console.log('');
  
  // 步骤 1: 调用技能执行端点 (期望 402)
  const executeUrl = 'http://127.0.0.1:28080/api/v1/pay/require?skill_did=did:stablepay:demo-skill&amount=1&currency=USDC';
  console.log('步骤 1: 调用技能执行端点...');
  
  const firstAttempt = await client.executeDemoSkill(executeUrl, agentDid);
  if (firstAttempt.status !== 402) {
    console.log('意外状态:', firstAttempt.status);
    console.log(JSON.stringify(firstAttempt.body, null, 2));
    return;
  }
  
  console.log('✓ 收到 402 Payment Required');
  const requirement = firstAttempt.body.data;
  const price = requirement.price || '1.00';
  const currency = requirement.currency || 'USDC';
  console.log('  价格:', price, currency);
  console.log('  技能 DID:', requirement.skill_did);
  console.log('');
  
  // 步骤 2: 构建支付签名数据
  console.log('步骤 2: 构建支付签名...');
  const unixTimestamp = Math.floor(Date.now() / 1000);
  const paymentNonce = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const amountMinor = toMinorUnits(price);
  const currencyCode = currency === 'USDT' ? 2 : 1;
  const paymentSignData = `${agentDid}|${requirement.skill_did}|${amountMinor}|${currencyCode}|${unixTimestamp}|${paymentNonce}`;
  
  console.log('  签名数据:', paymentSignData);
  
  const paymentSignature = await runtime.signMessage({
    message: paymentSignData,
    chain: 'solana'
  });
  console.log('✓ 支付签名完成');
  console.log('');
  
  // 步骤 3: 构建网关签名
  console.log('步骤 3: 构建网关认证签名...');
  const payPayload = {
    agent_did: agentDid,
    skill_did: requirement.skill_did,
    amount: price,
    currency,
    signature: paymentSignature.signature,
    timestamp: unixTimestamp,
    nonce: paymentNonce
  };
  
  const payBody = JSON.stringify(payPayload);
  const gatewayTimestamp = new Date().toISOString();
  const gatewayNonce = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}-gw`;
  const canonical = `POST\n${requirement.payment_endpoint || '/api/v1/pay'}\n\n${createHash('sha256').update(payBody, 'utf8').digest('hex')}`;
  
  console.log('  Canonical:', canonical.substring(0, 50) + '...');
  
  const gatewaySignature = await runtime.signMessage({
    message: canonical,
    chain: 'solana',
    timestamp: gatewayTimestamp,
    nonce: gatewayNonce,
    append_timestamp_nonce: true
  });
  console.log('✓ 网关签名完成');
  console.log('');
  
  // 步骤 4: 发送支付请求
  console.log('步骤 4: 发送支付请求...');
  const payResponse = await client.paySigned(payPayload, {
    'X-StablePay-DID': agentDid,
    'X-StablePay-Signature': gatewaySignature.signature,
    'X-StablePay-Timestamp': gatewayTimestamp,
    'X-StablePay-Nonce': gatewayNonce,
    'X-Idempotency-Key': `openclaw-${paymentNonce}`
  });
  console.log('✓ 支付响应:');
  console.log(JSON.stringify(payResponse, null, 2));
  console.log('');
  
  // 步骤 5: 重试技能执行
  console.log('步骤 5: 重试技能执行...');
  const retryAttempts = 6;
  const retryDelayMs = 1500;
  
  for (let i = 0; i < retryAttempts; i++) {
    await new Promise(r => setTimeout(r, retryDelayMs));
    const finalAttempt = await client.executeDemoSkill(executeUrl, agentDid);
    console.log(`  尝试 ${i + 1}/${retryAttempts}: 状态 ${finalAttempt.status}`);
    
    if (finalAttempt.status === 200) {
      console.log('');
      console.log('✅ 付费技能演示成功完成!');
      console.log('最终响应:', JSON.stringify(finalAttempt.body, null, 2));
      return;
    }
  }
  
  console.log('');
  console.log('⚠️ 支付已提交，但后端仍未返回 200');
}

executePaidSkillDemo().catch(err => {
  console.error('执行失败:', err.message);
  if (err.payload) {
    console.error('响应:', JSON.stringify(err.payload, null, 2));
  }
});
