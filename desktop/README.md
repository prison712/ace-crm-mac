# OmniTranslate（electron-app）

多平台聊天翻译桌面客户端：邀请码登录、BrowserView 会话隔离、可选指纹伪装、LINE 线索上报。

## 环境要求

- Node.js 18+（推荐 20；构建工具用，运行时由 Electron 内嵌 Node 16）
- Yarn 1.x
- Windows 10/11（打包与日常使用优先）
- Electron **22.3.27**（对齐海王出海魔改运行时，便于替换 DLL）
- 后端：Docker Compose，或自行运行 `backend/` 二进制

## 快速开始

### 1. 启动后端

```bash
cd backend
cp .env.example .env   # 修改 JWT_SECRET；勿提交真实 .env
docker compose up -d --build
```

默认 HTTPS 端口 **443**（本机绑定 443 在 Windows 上通常需要管理员权限）。证书目录：`backend/certs/`。

管理页：浏览器打开 `https://omnitranslate.org/admin/`，使用超管账号创建 **8 位邀请码**。

> 开发若暂时用本地后端，在客户端「用户设置 → 后端地址」填写完整 base URL（无尾斜杠），例如 `http://127.0.0.1:3456`。默认正式地址为 `https://omnitranslate.org`。

### 2. 安装并开发客户端

```bash
cd electron-app
yarn
yarn dev
```

登录页填写：

1. **后端地址**（默认 `https://omnitranslate.org`，可改）
2. **8 位邀请码**

登录后在用户设置中配置 Gemini / DeepSeek API Key，即可使用各平台翻译。

### 3. 跑通「登录 → LINE → 线索上报」

1. 邀请码登录成功  
2. 打开 **LINE** 渠道标签（首次会从官网下载 Chrome 扩展，详见 [docs/LINE-EXTENSION.md](docs/LINE-EXTENSION.md)）  
3. 在 LINE 内登录账号，并打开「可能认识的人」等相关列表  
4. 约 8s 后脚本灌缓存；之后每 60s 仅上报**新增**推荐联系人  
5. 主进程日志可见 `[clue:…] upload ok — new_unique=…`  
6. 后端管理页查看该邀请码下统计变化  

无 `backendUrl` 或未登录时上报会跳过并打日志，不会崩溃。

## 功能对照

| 能力 | 说明 |
|------|------|
| 分组侧栏 + 渠道开关 | 用户设置中开关平台 |
| 多标签 + 备注 | 每标签独立会话 |
| 标签级代理 | 设置页配置并测试 IP |
| 收发目标语言 | 标签设置 |
| 翻译引擎 | Gemini / DeepSeek |
| 明暗主题 / i18n | 侧栏切换 |
| 消息闪烁 | 后台标签有新消息时 |
| 邀请码登录 | 无机器码 / 无 license 心跳 |
| 指纹开关 | 默认关闭，见下文 |
| LINE 线索 | 自动上报 `/api/upload` |

## 指纹伪装（海王 DLL 替换）

指纹配置会在创建标签时生成并写入：

```
{userData}/fingerprints/{tabId}.json
```

在**原版 Electron** 上，`--alidoa` 等魔改参数通常无效；因此：

1. 默认保持 **指纹伪装 = 关闭**（`{userData}/settings.json` 中 `fingerprintEnabled: false`）  
2. 用本仓库正常编译、打出安装包或 `win-unpacked`  
3. 用你持有的**海王魔改运行时**替换产物目录中的对应二进制 / DLL（勿把补丁文件提交进 git；仓库已忽略 `**/patched-electron/**`、`**/*fingerprint*.dll`）  
4. 替换完成后再在用户设置中打开「指纹伪装」  
5. **重建会话**后生效：关闭再打开标签，或改一次代理触发 recreate  

详细步骤见 [docs/FINGERPRINT.md](docs/FINGERPRINT.md)。

## 打包（Windows）

```bash
cd electron-app
yarn build:win      # NSIS 安装包 → dist/
# 或
yarn build:unpack   # 未打包目录 → dist/win-unpacked/
```

- 应用名：`OmniTranslate`  
- 图标：`build/icon.ico`、`resources/icon.png`  
- 产物目录 `dist/` / `release/` 已在 `.gitignore`（当前默认输出为 `dist/`）  

## 项目结构（摘要）

```
electron-app/
  src/main/           # 主进程：BrowserView、翻译、指纹、线索
  src/preload/        # 主窗 + BrowserView preload
  src/renderer/       # React UI
  docs/               # LINE 扩展、指纹说明
backend/              # 邀请码后端（勿改业务；仅配置 .env）
```

## 安全提示

- **不要提交** `backend/.env` 或真实 `JWT_SECRET`  
- 邀请码与 JWT 等同于账号凭证，勿泄露  
- 指纹补丁 / 魔改 DLL 仅放本机产物目录，勿入库  

## 相关文档

- [LINE 扩展加载](docs/LINE-EXTENSION.md)
- [指纹与 DLL 替换](docs/FINGERPRINT.md)
- 仓库根目录 `编写计划.txt` / `架构说明.txt`
