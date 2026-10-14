# 指纹伪装与海王运行时替换

OmniTranslate 会为每个标签生成并持久化一套指纹配置（对齐海王字段）。完整伪装依赖**魔改 Chromium/Electron 运行时**；官方 Electron 仅能可靠应用 UA 等少数项，其余参数会静默降级。

## 默认行为

| 项 | 值 |
|----|-----|
| `fingerprintEnabled` | `false`（用户设置可改，写入 `{userData}/settings.json`） |
| 配置文件 | `{userData}/fingerprints/{tabId}.json` |
| 删标签 | 同时删除对应指纹文件 |
| 代理重建会话 | **不**删除指纹文件（同 tabId 复用） |

关闭开关时：仍会 `ensureFingerprint` 生成/读取文件，但**不会**向 BrowserView 传入 `--alidoa` / 魔改相关参数。

## 推荐工作流

1. **先正常打包**
   ```bash
   cd electron-app
   yarn build:unpack
   # 产物：electron-app/dist/win-unpacked/
   ```
   或 `yarn build:win` 安装后再定位安装目录。

2. **替换魔改文件**  
   将海王侧提供的 Electron/Chromium 相关二进制与 DLL，覆盖到 `win-unpacked`（或安装目录）中对应路径。  
   具体文件清单以你持有的魔改包为准（常见为可执行文件旁的 DLL / 资源）；本仓库**不内置**补丁包。

3. **本地验证目录（可选）**  
   可把一份完整 patched 运行时放在本机 `patched-electron/` 做对照；该路径已在仓库 `.gitignore` 中。

4. **开启开关**  
   启动应用 → 用户设置 → 打开「指纹伪装」。

5. **重建会话**  
   关闭现有标签再开，或对标签修改代理并应用，使新 BrowserView 带上指纹参数。

## 开关文案说明

设置页提示：「替换海王魔改运行时之前请保持关闭；替换后再开启。开启后需重建会话才生效。」

## 排障

- **替换 DLL 后打不开 / 控制台出现 `Isolate::Initialize` / `FailureMessage` 原生崩溃**  
  几乎一定是**魔改包与当前 Electron 主版本不一致**，或只替换了部分文件导致官方与魔改混用。  
  本项目当前依赖：**Electron `22.3.27`**（与 `参考程序/haiwangchuhai` 运行时一致：`Electron/22.3.27` · Chromium 108）。  
以 `package.json` / `yarn.lock` 为准。  
  **处理：**
  1. 删掉被改过的目录，重新安装/打包恢复官方运行时：  
     - 开发：`cd electron-app && Remove-Item -Recurse -Force node_modules\electron; yarn`  
     - 产物：删掉 `dist/win-unpacked` 后重新 `yarn build:unpack`  
  2. 海王魔改包必须对应 **Electron 22.3.27**（与本仓库一致）。  
  3. 用**整包**覆盖 `win-unpacked`（或 `node_modules/electron/dist`）里对应文件，不要只拷一两个 DLL。  
  4. 先确认能正常启动，再在用户设置里打开「指纹伪装」。

- 开启后网站指纹仍与本机一致：多半尚未替换魔改运行时，或会话未重建。  
- 配置文件已有但无效：检查 `fingerprintEnabled` 是否为 `true`，以及产物是否被杀软还原成官方 Electron。  
- 勿把含补丁的 `release/` 或 DLL 提交到 git。
