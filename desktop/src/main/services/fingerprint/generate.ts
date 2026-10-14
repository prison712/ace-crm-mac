import { FONT_FAMILIES, GPU_PROFILES } from './constants'
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
  type FingerprintConfig
} from './types'

const isMac = process.platform === 'darwin'

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)]!
}

function randomGpu(): Pick<
  FingerprintConfig,
  'gl_vendor' | 'gl_renderer' | 'gpu_vendor' | 'gpu_arch'
> {
  const groups = GPU_PROFILES.filter((g) => (isMac ? g.system === 'mac' : g.system === 'window'))
  const group = pick(groups.length > 0 ? groups : GPU_PROFILES)
  const renderer = pick(group.renderers)
  return {
    gl_vendor: renderer.gl_vendor,
    gl_renderer: renderer.gl_renderer,
    gpu_vendor: renderer.gpu_vendor,
    gpu_arch: renderer.gpu_arch
  }
}

function randomRemoveFamily(min = 1, max = 1): string {
  const pool = [...FONT_FAMILIES]
  const count = Math.min(randInt(min, max), pool.length)
  const picked = new Set<string>()
  while (picked.size < count && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length)
    picked.add(pool[i]!)
    pool.splice(i, 1)
  }
  return [...picked].join(',')
}

function randomMacAddress(): string {
  return Array.from({ length: 6 }, () =>
    Math.floor(256 * Math.random())
      .toString(16)
      .padStart(2, '0')
  ).join(':')
}

function randomSerial(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  for (let i = 0; i < 10; i++) out += chars.charAt(Math.floor(Math.random() * chars.length))
  return out
}

function randomHostName(): string {
  if (isMac) {
    const names = ['MacBook-Pro', 'MacBook-Air', 'iMac', 'Mac-mini', 'Mac-Studio']
    return `${pick(names)}-${Math.random().toString(36).slice(2, 6)}`
  }
  const names = ['DESKTOP', 'PC', 'LAPTOP', 'WORKSTATION']
  return `${pick(names)}-${Math.random().toString(36).slice(2, 9).toUpperCase()}`
}

function randomOsVersion(): string {
  if (isMac) {
    return pick([
      'macOS Ventura 13.0',
      'macOS Ventura 13.1',
      'macOS Ventura 13.2',
      'macOS Monterey 12.6',
      'macOS Monterey 12.7',
      'macOS Big Sur 11.7'
    ])
  }
  return 'Windows 11'
}

function randomModel(): string {
  if (isMac) {
    return pick(['MacBook Pro', 'MacBook Air', 'iMac', 'Mac mini', 'Mac Studio'])
  }
  return pick(['Dell OptiPlex', 'HP EliteDesk', 'Lenovo ThinkCentre', 'ASUS VivoMini'])
}

function randomBatteryValue(): FingerprintConfig['batteryValue'] {
  return {
    enable: 'true',
    battery_charging: Math.random() > 0.5 ? 'true' : 'false',
    battery_time: Math.floor(100 * Math.random()) + 1,
    battery_discharging_time: Math.floor(100 * Math.random()) + 1,
    battery_level: parseFloat(Math.random().toFixed(2))
  }
}

/** 运行时 Chromium 主版本；海王/Electron 22 为 108 */
export function runtimeChromeMajor(): string {
  return process.versions.chrome?.split('.')[0] || '108'
}

/** 与当前 Electron 内嵌 Chromium 完全一致的 Chrome UA（无随机次版本） */
export function runtimeChromeUserAgent(): string {
  const chrome = process.versions.chrome || '108.0.0.0'
  if (isMac) {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}

/** 对齐海王 qae：构造带随机次版本号的 Chrome UA */
export function generateUserAgent(majorVersion = runtimeChromeMajor()): string {
  const full = `${majorVersion}.${randInt(0, 9)}.${randInt(0, 9999)}.${randInt(0, 9999)}`
  if (isMac) {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`
}

/**
 * 对齐海王 randomFingerprint：Ule 默认模板 + ape 伪装覆盖 + 随机 UA
 */
export function generateRandomFingerprint(): FingerprintConfig {
  const chromeMajor = runtimeChromeMajor()

  return {
    doNotTrack: Math.random() > 0.5 ? 'true' : 'false',
    version: chromeMajor,
    system: isMac ? 'macOS' : 'windows',
    webGl: WebglMetadataType.CUSTOM,
    ...randomGpu(),
    webglImage: WebglImageType.RANDOM,
    webGPUValue: parseFloat((0.5 * Math.random()).toFixed(6)),
    webRTC: WebRTCType.DISABLE,
    timeZoneType: TimeZoneType.IP,
    location: LocationType.ASK,
    position: true,
    languageType: LanguageType.IP,
    languageIpValue: [],
    resolution: ResolutionType.REAL,
    font: FontType.REAL,
    remove_family: randomRemoveFamily(),
    canvas: CanvasType.RANDOM,
    canvasValue: Math.floor(1e6 * Math.random()),
    audioContext: AudioContextType.RANDOM,
    audioValue: parseFloat((0.5 * Math.random()).toFixed(6)),
    audio_input_device: Math.floor(5 * Math.random()) + 1,
    audio_output_device: Math.floor(4 * Math.random()) + 1,
    mediaEquipment: '1',
    clientRects: ClientRectsType.RANDOM,
    clientRectsValue: parseFloat((1.0000001 + 2e-7 * Math.random()).toFixed(7)),
    speechVoices: '1',
    deviceType: DeviceInfoType.CUSTOM,
    os_version: randomOsVersion(),
    serial: randomSerial(),
    model: randomModel(),
    host_name: randomHostName(),
    macAddress: randomMacAddress(),
    hardwareType: HardwareType.CUSTOM,
    hardwareValue: pick([4, 8, 16, 24]),
    memoryType: MemoryType.CUSTOM,
    memoryValue: pick([4, 8]),
    bluetooth: BluetoothType.ENABLE,
    battery: BatteryType.REAL,
    batteryValue: randomBatteryValue(),
    networkType: NetworkType.REAL,
    portType: PortType.ENABLE,
    portValue: '20,22',
    userAgent: generateUserAgent(chromeMajor)
  }
}
