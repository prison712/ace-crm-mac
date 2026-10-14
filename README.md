# ACE CRM 苹果客户端

本仓库只用于在 GitHub Actions 上编译 macOS 安装包。源码来自 `智能工作台/desktop`，不要在这里直接改代码。

## 发布流程

1. 同步源码（在 `智能工作台` 目录执行）

   ```bash
   node scripts/sync-mac-client.js
   ```

2. 推送到 GitHub（在 `苹果客户端` 目录执行）

   ```bash
   git add -A
   git commit -m "mac 1.0.xx"
   git push
   ```

3. 打开 GitHub 仓库的 **Actions → Build macOS client**，等编译完成，在页面底部 **Artifacts** 下载 `ACE-CRM-mac-版本号.zip`。

4. 上传到服务器（在 `智能工作台` 目录执行，zip 不用解压）

   ```powershell
   $env:DEPLOY_PASS = '服务器密码'
   node server/scripts/upload-mac-release.js C:\Users\你\Downloads\ACE-CRM-mac-1.0.xx.zip
   Remove-Item Env:DEPLOY_PASS
   ```

上传后：

- 下载页：http://8.219.152.183:3088/download/mac
- 更新清单：http://8.219.152.183:3088/api/app/updates/latest-mac.yml

## 首次打开提示“已损坏”或“无法验证开发者”

安装包没有 Apple 开发者证书签名。把应用拖进“应用程序”后，在终端执行一次：

```bash
xattr -cr "/Applications/ACE CRM.app"
```
