# Windows 版（Electron 便携）

DeepSeek Harness 的 Windows 桌面客户端。

- **技术栈**：Electron 37（内置 Node 22）+ electron-builder NSIS 打包
- **安装包**：`DeepSeek.Harness.Setup.*.exe`
- **开箱即用**：安装包内置完整 dsh 运行时，**无需安装 Node.js**

## 安装

1. 从 [Releases](https://github.com/EnJoy810/dsh-desktop/releases) 下载 `DeepSeek.Harness.Setup.*.exe`
2. 双击运行安装向导（可选择安装目录，自动创建桌面/开始菜单快捷方式）
3. 首次运行 SmartScreen 提示：点「更多信息 → 仍要运行」

## 使用

| 操作 | 快捷键 |
|------|--------|
| 更换背景 | `Ctrl+B`（菜单 View → Change Background…） |
| 恢复默认背景 | 菜单 View → Reset Background |
| 放大 / 缩小 / 还原 | `Ctrl+`=` / `Ctrl+-` / `Ctrl+0` |
| 重新加载 | `Ctrl+R` |
| 开发者工具 | `Ctrl+Shift+I` |

背景缓存在 `%APPDATA%/DeepSeek Harness/background.jpg`，重启自动恢复。

> **启动失败诊断**：server 日志写入 `%APPDATA%/DeepSeek Harness/dsh-server.log`；启动失败时窗口会显示错误页并附日志路径。

## 配置 DeepSeek API（免费）

应用默认使用商汤 SenseNova 平台的免费 DeepSeek 模型（`deepseek-v4-flash`）。首次使用需配置 API Key：

1. 前往 [platform.sensenova.cn](https://platform.sensenova.cn) 手机号注册，在「控制台 → API Key 管理」创建 Key（`sk-` 开头，**只显示一次**）
2. 设置环境变量（PowerShell）：`setx SENSENOVA_API_KEY "sk-你的密钥"`，设置后重启应用

详见根目录 [README](../README.md#-配置-deepseek-api免费)。

## 从源码构建

```bash
npm install
npm start            # 开发运行（自动拉起内置 dsh web）
npm run dist         # 打包 NSIS 安装程序 → dist/*Setup*.exe
npm run dist:dir     # 免安装绿色版 → dist/win-unpacked/
```

## 便携化说明

应用不依赖用户机器上的 Node.js：用 Electron 自身二进制以 `ELECTRON_RUN_AS_NODE` 模式作为 Node 运行时，启动内置的 `resources/vendor/node_modules/@deepseek-ai/dsh/lib/bin.js`。首次运行自动在 `~/.dsh` 生成配置（settings.yaml + profiles 模板）。

**同步 vendor（依赖树）**——从本机 npx 缓存刷新内置依赖：

```bash
rsync -a --delete ~/.npm/_npx/*/node_modules/ vendor/node_modules/
cp -R ~/.dsh/settings.yaml vendor/dsh-config/
cp -R ~/.dsh/profiles vendor/dsh-config/
# sharp 补 Windows 预编译（否则图片处理会失败）
npm pack @img/sharp-win32-x64@0.35.3 @img/sharp-libvips-win32-x64@0.35.3
```

> ⚠️ **不要降级 Electron**：dsh 需要 Node 22.5+ 的 `node:zlib.createZstdDecompress` 和 Node 22.6+ 的 `node:module.stripTypeScriptTypes`，Electron 33（Node 20）会启动失败。

## 文件结构

```
src/main.js          主进程：server 生命周期、窗口、菜单、背景注入、换背景
src/preload.js       contextBridge 预加载桥
assets/bg.jpg        默认奶鲸背景
build/icon.ico       Windows 应用图标
vendor/dsh-config/   首次运行种子化的 ~/.dsh 配置模板
```
