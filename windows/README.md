# dsh-windows

DeepSeek Harness 桌面应用 — **Windows 版**（Electron）。

这是 `dsh-macos`（Swift + WKWebView）的 Windows 移植：用 Electron 承载 DeepSeek Harness Web UI（`http://127.0.0.1:3080`），并移植了 macOS 版的全部定制功能。

## 功能

- **开箱即用（便携）**：安装包内置完整的 dsh 依赖树（`resources/vendor/`）与 `~/.dsh` 配置模板（settings.yaml + profiles）。运行时不依赖用户机器上的 Node.js——用 Electron 自身二进制以 `ELECTRON_RUN_AS_NODE` 模式作为 Node 运行时启动 dsh web server。
- 加载内置 `@deepseek-ai/dsh` web UI（`http://127.0.0.1:3080`），端口被占用时自动复用
- 自定义背景图：`View > Change Background…`（`Ctrl+B`）选任意图片作为窗口背景；`Reset Background` 恢复默认
- 背景持久化：缓存在 `%APPDATA%/DeepSeek Harness/background.jpg`，重启自动恢复
- 磨砂玻璃侧边栏（backdrop-filter）
- 页面缩放：`Ctrl+`=` / `Ctrl+-` / `Ctrl+0`（0.5×–3×）
- 启动失败诊断：server 日志写入 `%APPDATA%/DeepSeek Harness/dsh-server.log`，白屏时显示错误页并附日志路径

> 要求 Electron ≥ 37（内置 Node 22+），dsh 需要 `node:zlib.createZstdDecompress`（Node 22.5+）与 `node:module.stripTypeScriptTypes`（Node 22.6+）。Electron 33（Node 20）会启动失败——**不要降级**。

## 开发运行

```bash
npm install
npm start          # 启动 Electron，自动拉起内置 dsh web
```

> `vendor/` 目录是运行时依赖（dsh 全家桶 + win32 sharp 预编译），由 `npm run sync:vendor` 从本机 `~/.npm/_npx` 缓存同步（见下）。

## 同步 vendor（依赖树）

应用便携化依赖 `vendor/node_modules`（完整 dsh 依赖树）与 `vendor/dsh-config`（settings.yaml + profiles 模板）。从本机 npx 缓存同步：

```bash
rsync -a --delete ~/.npm/_npx/*/node_modules/ vendor/node_modules/
cp -R ~/.dsh/settings.yaml vendor/dsh-config/
cp -R ~/.dsh/profiles vendor/dsh-config/
# sharp 需补 Windows 预编译（否则 Windows 上图片处理会失败）
npm pack @img/sharp-win32-x64@0.35.3 @img/sharp-libvips-win32-x64@0.35.3
```

## 打包 Windows 安装包

```bash
npm run dist       # electron-builder --win nsis → dist/*Setup*.exe
npm run dist:dir   # 免安装绿色版 → dist/win-unpacked/
```

## 目录结构

```
src/main.js     Electron 主进程：server 生命周期、窗口、菜单、换背景、背景注入
src/preload.js  预加载桥（contextBridge，预留）
assets/bg.jpg   默认奶鲸背景
build/icon.ico  Windows 应用图标
```
