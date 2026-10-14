import type { Session } from 'electron'
import {
  AudioContextType,
  BatteryType,
  BluetoothType,
  CanvasType,
  ClientRectsType,
  DeviceInfoType,
  FontType,
  HardwareType,
  LanguageType,
  LocationType,
  MemoryType,
  NetworkType,
  PortType,
  ResolutionType,
  TimeZoneType,
  WebglImageType,
  WebglMetadataType,
  WebRTCType,
  type AlidoaResult,
  type FingerprintConfig,
  type ProxyConfig
} from './types'

const isMac = process.platform === 'darwin'

function getBrowserVersion(ua: string): {
  chrome?: { full: string; major: number }
} | null {
  if (!ua) return null
  const match = ua.match(/Chrome\/([\d.]+)/)
  if (!match?.[1]) return null
  const full = match[1]
  const major = parseInt(full.split('.')[0] || '0', 10)
  return { chrome: { full, major } }
}

/**
 * 移植海王 getFingerprint → alidoa + additionalArguments。
 * 原版 Electron 下 --alidoa 可能无效，调用方应允许静默降级。
 */
export function buildAlidoaArgs(
  fingerprint: FingerprintConfig,
  proxy: ProxyConfig = {}
): AlidoaResult {
  const additionalArguments: string[] = []
  try {
    if (!fingerprint.webGl) {
      return { alidoa: {}, additionalArguments }
    }

    const alidoa: Record<string, unknown> = {
      webdriver: false,
      debug: false,
      debugger: false,
      iframe: true,
      shadowroot: true,
      selenium: false,
      mouse: 1,
      platform: isMac ? 'Mac os' : 'Windows',
      platformVersion: '10.0.0',
      mobile: false,
      model: '',
      bitness: '64',
      wow64: false,
      enable_device_spoof: false,
      voice_tts_list: '0,3,60'
    }

    if (fingerprint.doNotTrack) {
      alidoa.doNotTrack = fingerprint.doNotTrack
    }

    if (fingerprint.userAgent) {
      const browserVersion = getBrowserVersion(fingerprint.userAgent)
      alidoa.ua = fingerprint.userAgent
      if (browserVersion?.chrome) {
        alidoa.versionList = [
          { brand: 'Chromium', version: browserVersion.chrome.major },
          { brand: 'Not)A;Brand', version: '24' },
          { brand: 'Google Chrome', version: browserVersion.chrome.major }
        ]
        alidoa.fullVersionList = [
          { brand: 'Chromium', version: browserVersion.chrome.full },
          { brand: 'Not)A;Brand', version: '24.0.0.0' },
          { brand: 'Google Chrome', version: browserVersion.chrome.full }
        ]
      }
      additionalArguments.push(`--user-agent=${fingerprint.userAgent}`)
    }

    if (fingerprint.webGl === WebglMetadataType.CUSTOM) {
      alidoa.enable_device_spoof = 'true'
      alidoa.gpu = {
        gl_vendor: fingerprint.gl_vendor,
        gl_renderer: fingerprint.gl_renderer,
        gpu_vendor: fingerprint.gpu_vendor,
        gpu_arch: fingerprint.gpu_arch
      }
      alidoa.architecture = isMac && fingerprint.gpu_vendor === 'Intel' ? 'x86' : 'arm'
    }

    if (fingerprint.webRTC === WebRTCType.REPLACE && proxy.enableServer && proxy.address) {
      alidoa.nowebrtc = 'false'
      alidoa.webrtc = {
        enable: true,
        'webrtc-ip': fingerprint.webRTCIp ?? ''
      }
    }

    if (fingerprint.webRTC === WebRTCType.REAL) {
      alidoa.nowebrtc = 'false'
      alidoa.webrtc = { enable: false }
    }

    if (fingerprint.webRTC === WebRTCType.DISABLE) {
      alidoa.nowebrtc = 'true'
    }

    if (fingerprint.location === LocationType.ASK && !fingerprint.position) {
      alidoa.position = {
        longitude: Number(fingerprint.longitude),
        latitude: Number(fingerprint.latitude)
      }
    }

    if (fingerprint.resolution === ResolutionType.CUSTOM && fingerprint.screen) {
      const [width, height] = fingerprint.screen.split('*')
      alidoa.screen = {
        width: Number(width),
        height: Number(height)
      }
    }

    if (fingerprint.font === FontType.CUSTOM) {
      alidoa.font = { remove_family: fingerprint.remove_family }
    }

    if (fingerprint.webglImage === WebglImageType.RANDOM) {
      alidoa.gl_rd = fingerprint.webGPUValue
    }

    if (fingerprint.canvas === CanvasType.RANDOM) {
      alidoa.canvas = fingerprint.canvasValue
    }

    if (fingerprint.audioContext === AudioContextType.RANDOM) {
      alidoa.audio = fingerprint.audioValue
    }

    if (fingerprint.clientRects === ClientRectsType.RANDOM) {
      alidoa.client_rects = fingerprint.clientRectsValue
    }

    if (fingerprint.networkType === NetworkType.CUSTOM) {
      alidoa.conn_type = fingerprint.conn_type
    }

    if (fingerprint.deviceType === DeviceInfoType.CUSTOM) {
      alidoa.enable_device_spoof = 'true'
      alidoa.device_info = {
        host_name: fingerprint.host_name,
        mac: fingerprint.macAddress,
        os_version: fingerprint.os_version,
        serial: fingerprint.serial,
        model: fingerprint.model
      }
    }

    if (fingerprint.hardwareType === HardwareType.CUSTOM) {
      alidoa.cpu = fingerprint.hardwareValue
    }

    if (fingerprint.memoryType === MemoryType.CUSTOM) {
      alidoa.memory = fingerprint.memoryValue
    }

    if (fingerprint.bluetooth === BluetoothType.ENABLE) {
      alidoa.bluetooth = 'true'
    }

    if (fingerprint.battery === BatteryType.PRIVACY) {
      alidoa.battery = fingerprint.batteryValue
    }

    if (fingerprint.portType === PortType.ENABLE && fingerprint.portValue) {
      alidoa.port = fingerprint.portValue
    }

    if (fingerprint.portType === PortType.DISABLE) {
      alidoa.port = '0'
    }

    if (fingerprint.languageType === LanguageType.IP && fingerprint.languageIpValue?.length) {
      const langs = fingerprint.languageIpValue.join(',')
      alidoa.httplanguages = langs
      alidoa.jslanguages = langs
      additionalArguments.push(`--lang=${fingerprint.languageIpValue[0]}`)
      additionalArguments.push(`--accept-lang=${fingerprint.languageIpValue[0]}`)
    }

    if (fingerprint.languageType === LanguageType.CUSTOM && fingerprint.languageValue?.length) {
      const langs = fingerprint.languageValue.join(',')
      alidoa.httplanguages = langs
      alidoa.jslanguages = langs
      additionalArguments.push(`--lang=${fingerprint.languageValue[0]}`)
      additionalArguments.push(`--accept-lang=${fingerprint.languageValue[0]}`)
    }

    if (fingerprint.timeZoneType === TimeZoneType.IP && fingerprint.timeZoneIp) {
      additionalArguments.push(`--time-zone-for-testing=${fingerprint.timeZoneIp}`)
    }

    if (fingerprint.timeZoneType === TimeZoneType.CUSTOM && fingerprint.timeZoneValue) {
      additionalArguments.push(`--time-zone-for-testing=${fingerprint.timeZoneValue}`)
    }

    // 海王注释「代理暂时不能用」：--proxy-server 带账密格式不可靠。
    // 正式流量走 session.setProxy + webContents `login`；此处只传 host:port 给运行时对齐。
    if (proxy.enableServer && proxy.address && proxy.port) {
      const proxyRules = `${proxy.serverType || 'http'}://${proxy.address}:${proxy.port}`
      additionalArguments.push(`--proxy-server=${proxyRules}`)
    }

    additionalArguments.push(`--alidoa=${JSON.stringify(alidoa)}`)
    return { alidoa, additionalArguments }
  } catch {
    return { alidoa: {}, additionalArguments: [] }
  }
}

/** 在标准 Electron 上可生效的部分：UA；其余 alidoa 参数依赖魔改运行时 */
export function applyFingerprintToSession(
  ses: Session,
  fingerprint: FingerprintConfig,
  alidoa: Record<string, unknown>
): void {
  try {
    const acceptLang =
      typeof alidoa.httplanguages === 'string' ? alidoa.httplanguages : undefined
    if (fingerprint.userAgent) {
      ses.setUserAgent(fingerprint.userAgent, acceptLang)
    }
  } catch {
    /* 静默降级 */
  }
}
