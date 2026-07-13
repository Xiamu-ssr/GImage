// 供应商注册表：模型配置只引用 provider 名称；新增兼容供应商只需编辑 JSON 和环境变量。
import { readRuntimeConfig } from './runtimeConfig.js';

let cache = null;

export async function loadProviderRegistry() {
  if (!cache) {
    const config = await readRuntimeConfig('providers', { providers: {} });
    cache = config.providers || {};
  }
  return cache;
}

export function clearProviderRegistryCache() { cache = null; }

export async function getProvider(id) {
  const providers = await loadProviderRegistry();
  const provider = providers[id];
  if (!provider || provider.enabled === false) throw new Error(`供应商不可用: ${id}`);
  return { id, ...provider };
}

export function providerValue(provider, key, fallback = '') {
  const envKey = provider[`${key}Env`];
  const value = (envKey && process.env[envKey]) || provider[key] || fallback;
  return typeof value === 'string' ? value.replace(/\/$/, '') : value;
}

export function providerApiKey(provider) {
  return provider.apiKeyEnv ? process.env[provider.apiKeyEnv] || '' : '';
}
