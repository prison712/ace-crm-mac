import type { ProxyConfig } from "./types";

export const EMPTY_PROXY: ProxyConfig = {
  host: "",
  port: 0,
  username: "",
  password: "",
};

export function buildProxyUrl(proxy: ProxyConfig): string | null {
  const host = proxy.host.trim();
  const port = proxy.port;
  if (!host || !port) return null;

  const user = proxy.username.trim();
  const pass = proxy.password;
  const auth =
    user.length > 0
      ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
      : "";

  return `http://${auth}${host}:${port}`;
}

export function parseLegacyProxyUrl(raw: string): ProxyConfig {
  const trimmed = raw.trim();
  if (!trimmed) return { ...EMPTY_PROXY };

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    return { ...EMPTY_PROXY };
  }
}

export function normalizeProxyConfig(
  proxy?: Partial<ProxyConfig> | null,
): ProxyConfig {
  if (!proxy) return { ...EMPTY_PROXY };
  return {
    host: proxy.host?.trim() ?? "",
    port: Number(proxy.port) || 0,
    username: proxy.username?.trim() ?? "",
    password: proxy.password ?? "",
  };
}
