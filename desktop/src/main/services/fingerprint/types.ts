/** 指纹配置：字段对齐海王 finger-config / randomFingerprint */

export enum WebglMetadataType {
  REAL = 'real',
  CUSTOM = 'custom',
  CLOSE_HARDWARE_ACCELERATION = 'closeHardwareAcceleration'
}

export enum WebglImageType {
  REAL = 'real',
  RANDOM = 'random'
}

export enum WebRTCType {
  REPLACE = 'replace',
  REAL = 'real',
  DISABLE = 'disable'
}

export enum TimeZoneType {
  REAL = 'real',
  IP = 'ip',
  CUSTOM = 'custom'
}

export enum LocationType {
  ASK = 'ask',
  DISABLE = 'disable'
}

export enum LanguageType {
  IP = 'ip',
  CUSTOM = 'custom'
}

export enum ResolutionType {
  REAL = 'real',
  CUSTOM = 'custom'
}

export enum FontType {
  REAL = 'real',
  CUSTOM = 'custom'
}

export enum CanvasType {
  RANDOM = 'random',
  REAL = 'real'
}

export enum AudioContextType {
  RANDOM = 'random',
  REAL = 'real'
}

export enum ClientRectsType {
  RANDOM = 'random',
  REAL = 'real'
}

export enum NetworkType {
  REAL = 'real',
  CUSTOM = 'custom'
}

export enum DeviceInfoType {
  REAL = 'real',
  CUSTOM = 'custom'
}

export enum HardwareType {
  REAL = 'real',
  CUSTOM = 'custom'
}

export enum MemoryType {
  REAL = 'real',
  CUSTOM = 'custom'
}

export enum BluetoothType {
  DISABLE = 'disable',
  ENABLE = 'enable'
}

export enum BatteryType {
  PRIVACY = 'privacy',
  REAL = 'real'
}

export enum PortType {
  ENABLE = 'enable',
  DISABLE = 'disable'
}

export interface BatteryValue {
  enable: string
  battery_charging: string
  battery_time: number
  battery_discharging_time: number
  battery_level: number
}

export interface FingerprintConfig {
  userAgent: string
  doNotTrack: string
  version: string
  system: 'macOS' | 'windows'
  webGl: WebglMetadataType
  gl_vendor: string
  gl_renderer: string
  gpu_vendor: string
  gpu_arch: string
  webglImage: WebglImageType
  webGPUValue: number
  webRTC: WebRTCType
  webRTCIp?: string
  timeZoneType: TimeZoneType
  timeZoneIp?: string
  timeZoneValue?: string
  location: LocationType
  position: boolean
  longitude?: string | number
  latitude?: string | number
  languageType: LanguageType
  languageIpValue?: string[]
  languageValue?: string[]
  resolution: ResolutionType
  screen?: string
  font: FontType
  remove_family: string
  canvas: CanvasType
  canvasValue: number
  audioContext: AudioContextType
  audioValue: number
  audio_input_device?: number
  audio_output_device?: number
  mediaEquipment?: string
  clientRects: ClientRectsType
  clientRectsValue: number
  speechVoices?: string
  deviceType: DeviceInfoType
  os_version: string
  serial: string
  model: string
  host_name: string
  macAddress: string
  hardwareType: HardwareType
  hardwareValue: number
  memoryType: MemoryType
  memoryValue: number
  bluetooth: BluetoothType
  battery: BatteryType
  batteryValue: BatteryValue
  networkType: NetworkType
  conn_type?: string
  portType: PortType
  portValue?: string
}

export interface ProxyConfig {
  enableServer?: boolean
  serverType?: string
  address?: string
  port?: number | string
  enableAuthentication?: boolean
  userName?: string
  password?: string
}

export interface AlidoaResult {
  alidoa: Record<string, unknown>
  additionalArguments: string[]
}
