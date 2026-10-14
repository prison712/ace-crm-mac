import { app } from 'electron'
import { execFile } from 'child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
  statSync,
  renameSync,
  cpSync
} from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { tmpdir } from 'os'
import { abortSignalTimeout, appFetch } from './http'
import { loadSettings } from './settings'

const execFileAsync = promisify(execFile)

export const LINE_EXTENSION_ID = 'ophjlpahpchlmihnnnihgmmeilfjmjjc'
/** 本地工作副本目录名（userData，可写，便于打 Electron shim） */
export const LINE_EXTENSION_DIR_NAME = 'line-ext'
/** 内置官方 LINE 扩展版本目录名 */
export const BUNDLED_LINE_EXTENSION_FOLDER = '3.7.1_0'
export const BUNDLED_LINE_EXTENSION_VERSION = '3.7.1'

/** 界面展示用：去掉历史打包里的品牌后缀 */
export function publicLineExtensionVersion(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw
    .replace(/-?haiwang/gi, '')
    .replace(/海王/g, '')
    .replace(/-+$/g, '')
    .trim()
  return cleaned || null
}

/** loadExtension 后实际分配的 ID（无 manifest.key 时与商店 ID 不同） */
let runtimeExtensionId: string | null = null

function runtimeIdFile(): string {
  return join(lineExtensionsParentDir(), '.runtime_extension_id')
}

export function setRuntimeLineExtensionId(id: string): void {
  const trimmed = id.trim()
  if (!trimmed) return
  runtimeExtensionId = trimmed
  try {
    writeFileSync(runtimeIdFile(), trimmed, 'utf-8')
  } catch {
    /* ignore */
  }
}

export function getRuntimeLineExtensionId(): string | null {
  if (runtimeExtensionId?.trim()) return runtimeExtensionId.trim()
  try {
    if (existsSync(runtimeIdFile())) {
      const v = readFileSync(runtimeIdFile(), 'utf-8').trim()
      if (v) {
        runtimeExtensionId = v
        return v
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

/** 必须传入或已缓存 loadExtension 的真实 ID；不再回退到商店 ID */
export function getLineEntryUrl(extId?: string | null): string {
  const id = (extId || getRuntimeLineExtensionId())?.trim()
  if (!id) {
    throw new Error('LINE 扩展运行时 ID 未知（请先 loadExtension）')
  }
  // 与海王 / 官方 chrome.windows.create 一致：index.html（不要用 #popout）
  return `chrome-extension://${id}/index.html`
}

interface LineExtensionLatest {
  version: string
  download_url: string
}

function resolveUrl(backendUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  try {
    return new URL(pathOrUrl, new URL(backendUrl).origin).toString()
  } catch {
    const base = backendUrl.replace(/\/$/, '')
    return pathOrUrl.startsWith('/') ? `${base}${pathOrUrl}` : `${base}/${pathOrUrl}`
  }
}

export function isLinePlatform(groupId: string): boolean {
  return groupId.trim() === 'line'
}

function lineExtensionsParentDir(): string {
  const dir = join(app.getPath('userData'), 'line-extensions')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 海王出海同款：打包进 resources/extensions/{id}/3.7.1_0
 * 开发态：electron-app/resources/...
 * 安装包：process.resourcesPath/extensions/...（extraResources）
 */
export function getBundledLineExtensionDir(): string | null {
  const rel = join('extensions', LINE_EXTENSION_ID, BUNDLED_LINE_EXTENSION_FOLDER)
  const candidates = [
    join(process.resourcesPath, rel),
    join(process.resourcesPath, 'app.asar.unpacked', 'resources', rel),
    // electron-vite：__dirname = out/main
    join(__dirname, '../../resources', rel),
    join(app.getAppPath(), 'resources', rel),
    join(app.getAppPath(), '..', 'resources', rel)
  ]
  for (const p of candidates) {
    try {
      if (existsSync(join(p, 'manifest.json'))) return p
    } catch {
      /* ignore */
    }
  }
  return null
}

function shouldUpdate(local: string | null, remote: string): boolean {
  if (!local) return true
  return local.trim() !== remote.trim()
}

async function fetchLatest(): Promise<LineExtensionLatest> {
  const { backendUrl } = loadSettings()
  const url = `${backendUrl}/api/line-extension/latest`
  const resp = await appFetch(url, {
    headers: { 'User-Agent': 'OmniTranslate/1.0' },
    signal: abortSignalTimeout(30_000)
  })
  if (!resp.ok) throw new Error(`获取 LINE 扩展版本失败: HTTP ${resp.status}`)
  const data = (await resp.json()) as LineExtensionLatest
  return {
    version: data.version,
    download_url: resolveUrl(backendUrl, data.download_url)
  }
}

async function downloadZip(url: string): Promise<Buffer> {
  const resp = await appFetch(url, {
    headers: { 'User-Agent': 'OmniTranslate/1.0' },
    redirect: 'follow',
    signal: abortSignalTimeout(120_000)
  })
  if (!resp.ok) throw new Error(`下载 LINE 扩展失败: HTTP ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  if (!buf.length) throw new Error('下载 LINE 扩展失败: 空文件')
  return buf
}

/** 若 zip 根目录多包一层文件夹，提升到目标目录 */
function flattenIfNested(extDir: string): void {
  const manifest = join(extDir, 'manifest.json')
  if (existsSync(manifest)) return
  const entries = readdirSync(extDir).filter((n) => !n.startsWith('.'))
  if (entries.length !== 1) return
  const nested = join(extDir, entries[0]!)
  if (!statSync(nested).isDirectory()) return
  if (!existsSync(join(nested, 'manifest.json'))) return
  const tmp = `${extDir}.__flatten__`
  rmSync(tmp, { recursive: true, force: true })
  renameSync(nested, tmp)
  for (const name of readdirSync(extDir)) {
    rmSync(join(extDir, name), { recursive: true, force: true })
  }
  for (const name of readdirSync(tmp)) {
    renameSync(join(tmp, name), join(extDir, name))
  }
  rmSync(tmp, { recursive: true, force: true })
}

async function extractZip(zipBytes: Buffer, dest: string): Promise<void> {
  const zipPath = join(tmpdir(), `omni-line-ext-${Date.now()}.zip`)
  writeFileSync(zipPath, zipBytes)
  try {
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    await execFileAsync('tar', ['-xf', zipPath, '-C', dest])
    flattenIfNested(dest)
  } finally {
    try {
      rmSync(zipPath, { force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * v17：去掉 sandbox 后扩展页默认 CSP 是 script-src 'self'，会拒绝 WebAssembly
 * （CompileError: neither wasm-eval nor unsafe-eval）→ INIT 失败 → ltsm_not_available。
 * 补 content_security_policy.extension_pages 的 'wasm-unsafe-eval'。
 * 仍去掉 sandbox（沙箱页不能用 chrome.*，LTSM/polyfill 需要）。
 * 另：相对路径 /static + locateFile + 根目录 ltsm.wasm 兜底。
 */
const ELECTRON_SHIM_VERSION = '17'

/** CRA 产物在 Electron 扩展页中的路径修复 */
function rewriteExtensionHtmlAssets(html: string): string {
  let out = html
  out = out.replace(/(src|href)="\/static\//g, '$1="./static/')
  // 无 defer 的入口脚本补回 defer，避免在 </body> 之前同步跑崩
  out = out.replace(
    /<script(?![^>]*\bdefer\b)(\s[^>]*\bsrc="[^"]*static\/js\/(?:main|ltsmSandbox|cropperSandbox)\.js"[^>]*)>/gi,
    '<script defer$1>'
  )
  return out
}

/** 强制 ltsm.wasm 走 chrome.runtime.getURL（外置脚本，避免 CSP 拦 inline） */
function ensureLtsmLocateFileBoot(html: string): string {
  if (html.includes('omni-ltsm-locate.js')) return html
  if (!/ltsmSandbox\.js/i.test(html)) return html
  const boot = '<script src="omni-ltsm-locate.js"></script>'
  if (html.includes('</head>')) return html.replace('</head>', `${boot}</head>`)
  return `${boot}${html}`
}

function writeLtsmLocateFileScript(extDir: string): void {
  writeFileSync(
    join(extDir, 'omni-ltsm-locate.js'),
    `/* OmniTranslate LTSM locateFile v${ELECTRON_SHIM_VERSION} */
(function () {
  try {
    var M = (window.Module = window.Module || {});
    M.locateFile = function (p) {
      p = String(p || '').split('/').pop();
      try {
        return chrome.runtime.getURL('static/js/' + p);
      } catch (e) {
        return './static/js/' + p;
      }
    };
  } catch (e) {}
})();
`,
    'utf-8'
  )
}

function ensureLtsmWasmAtExtensionRoot(extDir: string): void {
  const src = join(extDir, 'static', 'js', 'ltsm.wasm')
  const dest = join(extDir, 'ltsm.wasm')
  if (!existsSync(src)) return
  try {
    writeFileSync(dest, readFileSync(src))
    console.log('[omnitranslate] copied ltsm.wasm → extension root (LTSM defer fallback)')
  } catch (e) {
    console.warn('[omnitranslate] copy ltsm.wasm to root failed:', e)
  }
}

function patchLineExtensionForElectron(extDir: string): void {
  const marker = join(extDir, '.omni_electron_shim')
  try {
    if (existsSync(marker) && readFileSync(marker, 'utf-8').trim() === ELECTRON_SHIM_VERSION) {
      return
    }
  } catch {
    /* continue patch */
  }

  const manifestPath = join(extDir, 'manifest.json')
  if (!existsSync(manifestPath)) return

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<
      string,
      unknown
    >

    const dropPerms = new Set(['downloads', 'notifications', 'system.display', 'contextMenus'])
    // 保留 cookies：LINE 登录/会话依赖 chrome.cookies（lct）；Electron 会告警但海王也保留
    if (Array.isArray(manifest.permissions)) {
      const perms = (manifest.permissions as string[]).filter((p) => !dropPerms.has(p))
      if (!perms.includes('cookies')) perms.push('cookies')
      if (!perms.includes('storage')) perms.push('storage')
      manifest.permissions = perms
    }

    // 去掉 sandbox：沙箱页无 chrome.*，LTSM 需要 polyfill / tabs.getZoom
    delete manifest.sandbox

    // 关键：非 sandbox 扩展页默认 CSP 禁止编译 wasm，必须显式放行
    manifest.content_security_policy = {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'"
    }

    manifest.background = {
      service_worker: 'background.js'
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')

    writeFileSync(
      join(extDir, 'background.js'),
      `/* OmniTranslate Electron shim v${ELECTRON_SHIM_VERSION} */
self.addEventListener('install', (e) => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
console.log('[omnitranslate] LINE background shim ready');
`,
      'utf-8'
    )

    writeFileSync(
      join(extDir, 'omni-chrome-polyfill.js'),
      `/* OmniTranslate Electron chrome.* polyfill v${ELECTRON_SHIM_VERSION} */
(function () {
  if (typeof chrome === 'undefined') {
    console.warn('[omnitranslate] chrome is undefined');
    return;
  }

  function eventTarget() {
    return {
      addListener: function () {},
      removeListener: function () {},
      hasListener: function () { return false; },
      hasListeners: function () { return false; }
    };
  }

  function finish(result, callback) {
    if (typeof callback === 'function') {
      try { callback(result); } catch (_) {}
      return undefined;
    }
    return Promise.resolve(result);
  }

  function ensure(obj, key, factory) {
    try {
      if (obj[key] == null) obj[key] = factory();
    } catch (_) {
      try { obj[key] = factory(); } catch (__) {}
    }
    return obj[key];
  }

  // Electron 原生 tabs.getZoom 签名不兼容，必须强制覆盖（不能简单赋值）
  function forceFn(obj, key, fn) {
    try { delete obj[key]; } catch (_) {}
    try {
      Object.defineProperty(obj, key, {
        value: fn,
        writable: true,
        configurable: true,
        enumerable: true
      });
    } catch (_) {
      try { obj[key] = fn; } catch (__) {}
    }
  }

  if (!chrome.tabs) chrome.tabs = {};
  // 整表替换 zoom API，避免 Electron 原生「No matching signature」
  var tabsZoom = {
    getZoom: function (tabIdOrCb, maybeCb) {
      var cb = typeof tabIdOrCb === 'function' ? tabIdOrCb : maybeCb;
      return finish(1, cb);
    },
    setZoom: function (a, b, c) {
      var cb = typeof c === 'function' ? c : (typeof b === 'function' ? b : undefined);
      return finish(undefined, cb);
    },
    getZoomSettings: function (tabIdOrCb, maybeCb) {
      var cb = typeof tabIdOrCb === 'function' ? tabIdOrCb : maybeCb;
      return finish({ mode: 'automatic', scope: 'per-origin', defaultZoomFactor: 1 }, cb);
    },
    setZoomSettings: function () {
      var last = arguments.length ? arguments[arguments.length - 1] : undefined;
      var cb = typeof last === 'function' ? last : undefined;
      return finish(undefined, cb);
    }
  };
  forceFn(chrome.tabs, 'getZoom', tabsZoom.getZoom);
  forceFn(chrome.tabs, 'setZoom', tabsZoom.setZoom);
  forceFn(chrome.tabs, 'getZoomSettings', tabsZoom.getZoomSettings);
  forceFn(chrome.tabs, 'setZoomSettings', tabsZoom.setZoomSettings);
  // 若仍是原生函数，包一层
  try {
    var g = chrome.tabs.getZoom;
    var src = g && Function.prototype.toString.call(g);
    if (src && src.indexOf('[native code]') >= 0) {
      chrome.tabs = Object.assign(Object.create(Object.getPrototypeOf(chrome.tabs) || null), chrome.tabs, tabsZoom);
    }
  } catch (_) {
    try { Object.assign(chrome.tabs, tabsZoom); } catch (__) {}
  }
  ensure(chrome.tabs, 'onActivated', eventTarget);
  ensure(chrome.tabs, 'onUpdated', eventTarget);
  ensure(chrome.tabs, 'onRemoved', eventTarget);
  ensure(chrome.tabs, 'onCreated', eventTarget);

  if (!chrome.action) chrome.action = {};
  ensure(chrome.action, 'onClicked', eventTarget);
  ensure(chrome.action, 'onChanged', eventTarget);
  if (typeof chrome.action.setIcon !== 'function') {
    chrome.action.setIcon = function () { return Promise.resolve(); };
  }
  if (typeof chrome.action.setBadgeText !== 'function') {
    chrome.action.setBadgeText = function () { return Promise.resolve(); };
  }
  if (typeof chrome.action.setBadgeBackgroundColor !== 'function') {
    chrome.action.setBadgeBackgroundColor = function () { return Promise.resolve(); };
  }
  if (typeof chrome.action.setTitle !== 'function') {
    chrome.action.setTitle = function () { return Promise.resolve(); };
  }
  chrome.browserAction = chrome.browserAction || chrome.action;
  ensure(chrome.browserAction, 'onClicked', eventTarget);

  if (!chrome.contextMenus) chrome.contextMenus = {};
  ensure(chrome.contextMenus, 'onClicked', eventTarget);
  if (typeof chrome.contextMenus.create !== 'function') {
    chrome.contextMenus.create = function () { return 1; };
  }
  if (typeof chrome.contextMenus.removeAll !== 'function') {
    chrome.contextMenus.removeAll = function (cb) { return finish(undefined, cb); };
  }

  if (!chrome.notifications) chrome.notifications = {};
  ensure(chrome.notifications, 'onClicked', eventTarget);
  ensure(chrome.notifications, 'onClosed', eventTarget);
  ensure(chrome.notifications, 'onButtonClicked', eventTarget);
  if (typeof chrome.notifications.create !== 'function') {
    chrome.notifications.create = function () { return Promise.resolve(''); };
  }

  if (!chrome.commands) chrome.commands = {};
  ensure(chrome.commands, 'onCommand', eventTarget);

  if (!chrome.windows) chrome.windows = {};
  ensure(chrome.windows, 'onRemoved', eventTarget);
  ensure(chrome.windows, 'onFocusChanged', eventTarget);
  ensure(chrome.windows, 'onCreated', eventTarget);
  if (typeof chrome.windows.create !== 'function') {
    chrome.windows.create = function (opts, cb) {
      return finish({ id: 1, focused: true }, typeof opts === 'function' ? opts : cb);
    };
  }
  if (typeof chrome.windows.update !== 'function') {
    chrome.windows.update = function (id, opts, cb) {
      return finish({ id: id || 1 }, typeof opts === 'function' ? opts : cb);
    };
  }
  if (typeof chrome.windows.getCurrent !== 'function') {
    chrome.windows.getCurrent = function (cb) {
      return finish({ id: 1, focused: true }, cb);
    };
  }

  if (!chrome.system) chrome.system = {};
  if (!chrome.system.display) chrome.system.display = {};
  if (typeof chrome.system.display.getInfo !== 'function') {
    chrome.system.display.getInfo = function (cb) {
      return finish([{ bounds: { left: 0, top: 0, width: 1280, height: 800 } }], cb);
    };
  }

  console.warn('[omnitranslate] chrome.* polyfill v${ELECTRON_SHIM_VERSION} ready');

  // 诊断：记录 LTSM postMessage（含 error 载荷）
  try {
    if (!window.__OMNI_LTSM_LOG__) {
      window.__OMNI_LTSM_LOG__ = [];
      window.addEventListener('message', function (ev) {
        try {
          var d = ev.data;
          if (!d || typeof d !== 'object') return;
          if (d.type === 'loaded' || d.type === 'response' || d.type === 'error' || d.sandboxId) {
            var payload = d.data != null ? d.data : (d.error != null ? d.error : undefined);
            var brief = '';
            try {
              if (payload != null) {
                brief = typeof payload === 'string' ? payload : (payload.message || JSON.stringify(payload)).slice(0, 300);
              }
            } catch (_) {}
            window.__OMNI_LTSM_LOG__.push({
              type: d.type,
              sandboxId: d.sandboxId,
              brief: brief,
              t: Date.now()
            });
            if (window.__OMNI_LTSM_LOG__.length > 40) window.__OMNI_LTSM_LOG__.shift();
            if (d.type === 'error') {
              console.warn('[omnitranslate] ltsm-msg error', d.sandboxId || '', brief || payload || d);
            } else {
              console.warn('[omnitranslate] ltsm-msg', d.type, d.sandboxId || '');
            }
          }
        } catch (_) {}
      });
    }
  } catch (_) {}

  // 海王 main.js 会无条件调用这些回调；缺了会抛错并回滚 Redux draft
  var u = window.lineUtils || (window.lineUtils = {});
  if (typeof u.setUserInfo !== 'function') {
    u.setUserInfo = function (info) {
      try {
        window.localStorage.setItem('userInfo', JSON.stringify(info));
      } catch (_) {}
    };
  }
  if (typeof u.fetchAllContactFinish !== 'function') {
    u.fetchAllContactFinish = function () {};
  }
  if (typeof u.addContact !== 'function') {
    u.addContact = function () {};
  }
  if (typeof u.ReceiveEvent !== 'function') {
    u.ReceiveEvent = function () {};
  }
})();
`,
      'utf-8'
    )

    writeLtsmLocateFileScript(extDir)

    // 主页面 + LTSM/裁剪沙箱页：polyfill + 路径修复（版本升级时整页重写，不跳过）
    const polyfillTag = '<script src="omni-chrome-polyfill.js"></script>'
    for (const name of ['index.html', 'ltsmSandbox.html', 'cropperSandbox.html']) {
      const htmlPath = join(extDir, name)
      if (!existsSync(htmlPath)) continue
      let html = readFileSync(htmlPath, 'utf-8')
      // 去掉旧 locate（inline / 外置）与旧 polyfill，按当前版本重写
      html = html.replace(/<script[^>]*>\/\*__OMNI_LTSM_LOCATE__\*\/[\s\S]*?<\/script>/g, '')
      html = html.replace(/<script[^>]*src="omni-ltsm-locate\.js"[^>]*><\/script>/g, '')
      html = html.replace(/<script[^>]*src="omni-chrome-polyfill\.js"[^>]*><\/script>/g, '')
      html = rewriteExtensionHtmlAssets(html)
      if (name === 'ltsmSandbox.html') html = ensureLtsmLocateFileBoot(html)
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${polyfillTag}`)
      } else {
        html = `${polyfillTag}${html}`
      }
      writeFileSync(htmlPath, html, 'utf-8')
    }

    ensureLtsmWasmAtExtensionRoot(extDir)

    writeFileSync(marker, ELECTRON_SHIM_VERSION, 'utf-8')
    console.log(`[omnitranslate] patched LINE extension for Electron (v${ELECTRON_SHIM_VERSION})`)
  } catch (e) {
    console.warn('[omnitranslate] patch LINE extension failed:', e)
  }
}

function installFromBundled(extDir: string, bundled: string): void {
  if (existsSync(extDir)) rmSync(extDir, { recursive: true, force: true })
  mkdirSync(join(extDir, '..'), { recursive: true })
  cpSync(bundled, extDir, { recursive: true })
  // 去掉可能从源带过来的旧 shim，强制按当前版本重打
  try {
    rmSync(join(extDir, '.omni_electron_shim'), { force: true })
  } catch {
    /* ignore */
  }
  try {
    rmSync(join(extDir, 'omni-chrome-polyfill.js'), { force: true })
  } catch {
    /* ignore */
  }
  try {
    rmSync(join(extDir, 'omni-ltsm-locate.js'), { force: true })
  } catch {
    /* ignore */
  }
}

/**
 * 优先使用打包进程序的海王同款 LINE 扩展；必要时再回退官网下载。
 * 工作副本在 userData/line-extensions/line-ext（可写）。
 */
export async function ensureLineExtensionDir(): Promise<string> {
  const parent = lineExtensionsParentDir()
  const extDir = join(parent, LINE_EXTENSION_DIR_NAME)
  const versionFile = join(parent, '.installed_version')
  const localVersion = existsSync(versionFile)
    ? readFileSync(versionFile, 'utf-8').trim() || null
    : null

  const bundled = getBundledLineExtensionDir()
  if (bundled) {
    const needCopy =
      !existsSync(join(extDir, 'manifest.json')) ||
      localVersion !== BUNDLED_LINE_EXTENSION_VERSION
    if (needCopy) {
      console.log(
        `[omnitranslate] installing bundled LINE extension ${BUNDLED_LINE_EXTENSION_VERSION} from ${bundled}`
      )
      installFromBundled(extDir, bundled)
      writeFileSync(versionFile, BUNDLED_LINE_EXTENSION_VERSION, 'utf-8')
      try {
        rmSync(runtimeIdFile(), { force: true })
      } catch {
        /* ignore */
      }
      runtimeExtensionId = null
    }
    patchLineExtensionForElectron(extDir)
    return extDir
  }

  // 无内置包时：回退官网下载（兼容旧流程）
  console.warn('[omnitranslate] bundled LINE extension missing; falling back to download')
  const legacyDir = join(parent, 'ophjlpahpchlmihnnnihgmmeilfjmjjc')
  if (!existsSync(join(extDir, 'manifest.json')) && existsSync(join(legacyDir, 'manifest.json'))) {
    try {
      renameSync(legacyDir, extDir)
      runtimeExtensionId = null
    } catch {
      /* ignore */
    }
  }

  let latest: LineExtensionLatest | null = null
  try {
    latest = await fetchLatest()
  } catch (e) {
    if (existsSync(join(extDir, 'manifest.json'))) {
      console.warn(
        `[omnitranslate] LINE extension update check failed (${e}); using local copy`
      )
      patchLineExtensionForElectron(extDir)
      return extDir
    }
    throw e instanceof Error ? e : new Error(String(e))
  }

  const installedOk =
    existsSync(join(extDir, 'manifest.json')) &&
    localVersion !== null &&
    !shouldUpdate(localVersion, latest.version)

  if (installedOk) {
    patchLineExtensionForElectron(extDir)
    return extDir
  }

  console.log(
    `[omnitranslate] installing LINE extension ${latest.version} (local: ${localVersion})…`
  )
  const zipBytes = await downloadZip(latest.download_url)
  await extractZip(zipBytes, extDir)

  if (!existsSync(join(extDir, 'manifest.json'))) {
    throw new Error(
      'LINE 扩展下载后缺少 manifest.json。请确认已打包 resources/extensions，或在管理后台上传 ZIP。'
    )
  }

  writeFileSync(versionFile, latest.version, 'utf-8')
  try {
    rmSync(runtimeIdFile(), { force: true })
  } catch {
    /* ignore */
  }
  runtimeExtensionId = null
  patchLineExtensionForElectron(extDir)
  return extDir
}

/** 已安装则返回路径，否则 null（不抛错，供启动预热） */
export async function tryEnsureLineExtensionDir(): Promise<string | null> {
  try {
    return await ensureLineExtensionDir()
  } catch (e) {
    console.warn('[omnitranslate] LINE extension ensure failed:', e)
    return null
  }
}

export function getLocalLineExtensionDir(): string | null {
  const extDir = join(lineExtensionsParentDir(), LINE_EXTENSION_DIR_NAME)
  return existsSync(join(extDir, 'manifest.json')) ? extDir : null
}

/** 本地已安装的 LINE 扩展版本（.installed_version 或 manifest.json） */
export function getInstalledLineExtensionVersion(): string | null {
  const parent = lineExtensionsParentDir()
  const versionFile = join(parent, '.installed_version')
  if (existsSync(versionFile)) {
    const v = readFileSync(versionFile, 'utf-8').trim()
    if (v) return v
  }
  const manifestPath = join(parent, LINE_EXTENSION_DIR_NAME, 'manifest.json')
  if (!existsSync(manifestPath)) return null
  try {
    const raw = readFileSync(manifestPath, 'utf-8')
    const json = JSON.parse(raw) as { version?: unknown }
    const v = typeof json.version === 'string' ? json.version.trim() : ''
    return v || null
  } catch {
    return null
  }
}

export function getLineExtensionInfo(): {
  version: string | null
  extensionId: string | null
  entryUrl: string | null
} {
  const version = publicLineExtensionVersion(getInstalledLineExtensionVersion())
  const extensionId = getRuntimeLineExtensionId()
  let entryUrl: string | null = null
  try {
    if (extensionId) entryUrl = getLineEntryUrl(extensionId)
  } catch {
    entryUrl = null
  }
  return { version, extensionId, entryUrl }
}
