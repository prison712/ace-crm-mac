/**
 * 模拟 WhatsApp 登录页最严指纹（不加载 electron 主进程）：
 * generateRandomFingerprint → strip port → buildAlidoaArgs
 *
 *   cd electron-app && npx tsx scripts/sim-whatsapp-fp.ts
 */
import { buildAlidoaArgs } from '../src/main/services/fingerprint/apply'
import { generateRandomFingerprint } from '../src/main/services/fingerprint/generate'
import { PortType, type FingerprintConfig } from '../src/main/services/fingerprint/types'

function stripPortForLogin(fp: FingerprintConfig): FingerprintConfig {
  return { ...fp, portType: PortType.ENABLE, portValue: undefined }
}

function withPort(fp: FingerprintConfig): FingerprintConfig {
  return { ...fp, portType: PortType.ENABLE, portValue: fp.portValue || '20,22' }
}

function parseAlidoaArg(args: string[]): Record<string, unknown> {
  const raw = args.find((a) => a.startsWith('--alidoa='))
  if (!raw) throw new Error('缺少 --alidoa')
  return JSON.parse(raw.slice('--alidoa='.length)) as Record<string, unknown>
}

const mustHaveLogin = [
  'ua',
  'versionList',
  'fullVersionList',
  'gpu',
  'gl_rd',
  'canvas',
  'audio',
  'client_rects',
  'nowebrtc',
  'device_info',
  'cpu',
  'memory',
  'bluetooth'
] as const

function main(): void {
  // 模拟 Electron 22 / Chromium 108
  const prev = process.versions.chrome
  Object.defineProperty(process.versions, 'chrome', {
    value: '108.0.5359.215',
    configurable: true
  })

  const full = generateRandomFingerprint()
  const loginFp = stripPortForLogin(full)
  const postFp = withPort(full)

  const loginBuilt = buildAlidoaArgs(loginFp)
  const postBuilt = buildAlidoaArgs(postFp)
  const loginAlidoa = parseAlidoaArg(loginBuilt.additionalArguments)
  const postAlidoa = parseAlidoaArg(postBuilt.additionalArguments)

  console.log('=== WhatsApp 最严指纹模拟（真实 buildAlidoaArgs）===\n')
  console.log(`UA: ${String(loginAlidoa.ua).slice(0, 90)}...`)
  console.log(`Chrome major: ${String(loginAlidoa.ua).match(/Chrome\/(\d+)/)?.[1]}\n`)

  console.log('[登录期] 完整伪装项（应有） / port（应无）:')
  let failed = false
  for (const k of mustHaveLogin) {
    const ok = loginAlidoa[k] !== undefined && loginAlidoa[k] !== null
    console.log(`  ${ok ? '✓' : '✗'} ${k}`)
    if (!ok) failed = true
  }
  const noPort = loginAlidoa.port === undefined
  console.log(`  ${noPort ? '✓' : '✗'} port 已排除`)
  if (!noPort) failed = true

  console.log('\n[登录后重建] 应含 port:')
  const hasPort = postAlidoa.port !== undefined
  console.log(`  ${hasPort ? '✓' : '✗'} port = ${JSON.stringify(postAlidoa.port)}`)
  if (!hasPort) failed = true

  console.log('\n方案:')
  console.log('  WhatsApp 全程: 最严指纹 − alidoa.port（不重建视图，避免多窗口冲突）')

  if (prev !== undefined) {
    Object.defineProperty(process.versions, 'chrome', { value: prev, configurable: true })
  }

  if (failed) {
    console.error('\n模拟失败')
    process.exit(1)
  }
  console.log('\n模拟通过')
}

main()
