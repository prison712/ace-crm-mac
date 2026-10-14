/**
 * WhatsApp Web 会拒绝带 Electron 字样的 UA。
 * 对外报成与内置 Chromium 相同的 Chrome 版本，避免网页程序和引擎对不上而建库失败。
 */

/**
 * 读取当前 Electron 内置的 Chrome 版本。
 * @returns 主版本号与完整版本号
 */
function chromeVersion(): { major: string; full: string } {
  const full = process.versions.chrome || '152.0.0.0'
  const major = full.split('.')[0] || '152'
  return { major, full }
}

/**
 * 构造不含 Electron 标识的 Chrome UA。
 * @returns User-Agent 字符串
 */
export function whatsappChromeUa(): string {
  const { full } = chromeVersion()
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`
}

/**
 * WhatsApp 请求要带上的 Client Hints，版本与内置 Chrome 一致。
 * @returns 要覆盖的请求头
 */
export function whatsappClientHintHeaders(): Record<string, string> {
  const { major, full } = chromeVersion()
  return {
    'User-Agent': whatsappChromeUa(),
    'sec-ch-ua': `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-full-version': `"${full}"`,
    'sec-ch-ua-full-version-list':
      `"Google Chrome";v="${full}", "Chromium";v="${full}", "Not_A Brand";v="24.0.0.0"`
  }
}

/**
 * 在页面脚本之前改写 navigator，避免 WhatsApp 读到 Electron。
 * @returns 注入脚本
 */
export function whatsappUaSpoofScript(): string {
  const { major, full } = chromeVersion()
  const ua = JSON.stringify(whatsappChromeUa())
  const majorJson = JSON.stringify(major)
  const fullJson = JSON.stringify(full)
  return `(() => {
    const ua = ${ua};
    const major = ${majorJson};
    const full = ${fullJson};
    const brands = [
      { brand: 'Not_A Brand', version: '24' },
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major }
    ];
    const fullList = [
      { brand: 'Not_A Brand', version: '24.0.0.0' },
      { brand: 'Chromium', version: full },
      { brand: 'Google Chrome', version: full }
    ];
    try {
      Object.defineProperty(navigator, 'userAgent', { get: () => ua, configurable: true });
      Object.defineProperty(navigator, 'appVersion', { get: () => ua.replace(/^Mozilla\\//, ''), configurable: true });
      Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.', configurable: true });
    } catch (_) {}
    const uad = {
      brands,
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: function () {
        return Promise.resolve({
          brands,
          fullVersionList: fullList,
          mobile: false,
          platform: 'Windows',
          platformVersion: '15.0.0',
          architecture: 'x86',
          bitness: '64',
          model: '',
          uaFullVersion: full,
          wow64: false
        });
      },
      toJSON: function () { return { brands, mobile: false, platform: 'Windows' }; }
    };
    try {
      Object.defineProperty(navigator, 'userAgentData', { get: () => uad, configurable: true });
    } catch (_) {}
  })()`
}
