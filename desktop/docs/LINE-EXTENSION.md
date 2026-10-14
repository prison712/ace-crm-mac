# LINE Chrome 扩展

对齐海王出海：把已验证可用的 LINE 扩展**打包进客户端**。

## 内置路径

```
electron-app/resources/extensions/ophjlpahpchlmihnnnihgmmeilfjmjjc/3.7.1_0/
```

运行时工作副本：`{userData}/line-extensions/line-ext/`（版本标记 `3.7.1-haiwang`）。

## 加载要点

1. `session.loadExtension` → `chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html`
2. 先 `addBrowserView` 再 `loadURL`，`backgroundThrottling: false`
3. LINE：`contextIsolation: false` + `line-view` preload（`chrome.cookies` / `tabs` → `omni-crx-msg`）
4. 去掉 manifest `sandbox`（沙箱页无 chrome.*）；补 `content_security_policy` 的 `'wasm-unsafe-eval'`（否则 LTSM wasm 被 CSP 拦 → `ltsm_not_available`）
5. polyfill 注入 index / ltsmSandbox / cropperSandbox；`omni-ltsm-locate.js` + 根目录 `ltsm.wasm` 兜底
6. stub MV3 background
7. LINE 与其它平台一致启用 `--alidoa` + UA 指纹伪装（需重建标签生效）

## 验收

1. 日志：`patched LINE extension for Electron (v17)`、`chrome.* polyfill v17 ready`
2. 应出现登录页（含二维码区域），不应永远空白转圈 / `ltsm_not_available`
