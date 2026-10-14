import type { ProxyConfig, ProxyTestResult } from './types'

export async function testProxy(proxy: ProxyConfig): Promise<ProxyTestResult> {
  if (!proxy.host.trim() || !proxy.port) {
    return { success: false, message: '请填写主机与端口' }
  }
  return window.api.proxyTest({
    host: proxy.host.trim(),
    port: Number(proxy.port) || 0,
    username: proxy.username ?? '',
    password: proxy.password ?? ''
  })
}
