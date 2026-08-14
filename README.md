<p align="center">
  <img src="docs/cover.jpg" alt="DeepSeek Harness 桌面版" width="720">
</p>

<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  DeepSeek Harness 跨平台桌面客户端（macOS + Windows）· 自定义背景 · 磨砂侧边栏 · 开箱即用
</p>

---

> **面向 AI Agent**：本 README 同时供人类阅读与 AI 直接执行。如果你是 AI，请按「快速部署」中的步骤逐条执行，每步都有命令、预期结果与失败处理。目标：从零到可用（下载 → 安装 → 配置 API → 启动验证）一站式完成。

---

## 1. 项目身份

| 项 | 值 |
|----|----|
| 项目 | DeepSeek Harness 桌面客户端（`@deepseek-ai/dsh` 的桌面壳） |
| 仓库 | https://github.com/EnJoy810/dsh-desktop |
| 平台 | macOS（Swift + WKWebView）、Windows（Electron 便携） |
| 安装包 | GitHub Releases：https://github.com/EnJoy810/dsh-desktop/releases |
| 默认 LLM | 商汤 SenseNova 免费 DeepSeek 模型（`deepseek-v4-flash`） |

## 2. 前置条件

| 平台 | 要求 |
|------|------|
| macOS | macOS 12+；**需要 Node.js 22+**（dsh 依赖 `node:zlib.createZstdDecompress` / `node:module.stripTypeScriptTypes`） |
| Windows | Windows 10/11 x64；**无需 Node.js**（内置便携运行时） |

## 3. 快速部署（AI 请逐步执行）

### 3.1 下载安装包

```bash
# 从 GitHub Releases 获取最新版（两条命令任选，用 gh 更省事）
LATEST=$(gh release view --repo EnJoy810/dsh-desktop --json assets -q '.assets[] | select(.name|test("dmg$")) | .browser_download_url' 2>/dev/null)
echo "$LATEST"
```

- **macOS**：下载 `DeepSeek.Harness.dmg` → `hdiutil attach` → 将 `DeepSeek.app` 复制到 `/Applications` → `hdiutil detach`。
- **Windows**：下载 `DeepSeek.Harness.Setup.*.exe` → 双击运行 NSIS 安装向导（可自定义安装目录）。

> **未签名提示（首次运行必处理）**：
> - macOS：`sudo xattr -rd com.apple.quarantine /Applications/DeepSeek.app`（或右键 → 打开）
> - Windows：SmartScreen 提示时点「更多信息 → 仍要运行」

### 3.2 配置 DeepSeek API（免费，必须）

应用内置 SenseNova Provider，模型 `deepseek-v4-flash` 公测免费。步骤如下：

1. **注册**：打开 https://platform.sensenova.cn → 手机号注册并登录（公测免费、免绑卡）。
2. **创建 API Key**：控制台 → API Key 管理 → 创建 API Key → 复制 `sk-` 开头的密钥（**只显示一次**，立即保存）。
3. **设置环境变量**：

```bash
# macOS / Linux（写入 shell 配置使其永久生效）
echo 'export SENSENOVA_API_KEY="sk-你的密钥"' >> ~/.zshrc && source ~/.zshrc
# 或临时生效
export SENSENOVA_API_KEY="sk-你的密钥"

# Windows（PowerShell，设置后需重启应用）
setx SENSENOVA_API_KEY "sk-你的密钥"
```

4. **验证环境变量**：

```bash
# macOS / Linux
echo $SENSENOVA_API_KEY | head -c 8   # 期望输出 sk- 开头
# Windows
echo %SENSENOVA_API_KEY%
```

> 应用首次运行会自动生成 `~/.dsh/settings.yaml`（含 SenseNova Provider 配置，引用 `SENSENOVA_API_KEY`），无需手动编辑。

### 3.3 启动与验证

```bash
# 启动应用（macOS 双击 DeepSeek.app；Windows 双击快捷方式）
# 应用会自动：探测 3080 端口 → 无服务则拉起内置 dsh web → 加载对话界面

# 验证 1：dsh web 服务在跑
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080   # 期望 200

# 验证 2：在对话窗口发送任意消息，确认模型正常回复（验证 API Key 已生效）
```

**验证失败排查**：
- 端口非 200 → 查看日志：macOS 终端直接看；Windows 看 `%APPDATA%/DeepSeek Harness/dsh-server.log`（启动失败时窗口也会显示错误页）。
- 模型回复报鉴权错误 → 检查 `SENSENOVA_API_KEY` 是否正确设置（步骤 3.2）。

## 4. 日常使用

| 操作 | macOS | Windows |
|------|-------|---------|
| 更换背景 | `⌘B`（View → Change Background…） | `Ctrl+B` |
| **选择默认背景** | `View → Default Background → 🐋 奶鲸 1 / 2 / 3` | `View → Default Background → 🐋 奶鲸 1 / 2 / 3` |
| 恢复默认背景 | View → Reset Background | View → Reset Background |
| 页面缩放 | `⌘+` / `⌘-` / `⌘0` | `Ctrl+`=` / `Ctrl+-` / `Ctrl+0` |
| 重新加载 | `⌘R` | `Ctrl+R` |

### 🎨 内置默认背景（多选）

应用内置三张精选背景（`assets/backgrounds/`），可在菜单中一键选择并持久化：

| 奶鲸 1（扁平卡通） | 奶鲸 2（3D 胖鲸） | 奶鲸 3（3D + Deepseek logo） |
|:---:|:---:|:---:|
| ![bg-1](assets/backgrounds/bg-1.jpg) | ![bg-2](assets/backgrounds/bg-2.jpg) | ![bg-3](assets/backgrounds/bg-3.jpg) |

背景缓存：macOS `~/Library/Application Support/DeepSeek/background.jpg`；Windows `%APPDATA%/DeepSeek Harness/background.jpg`。

## 5. 故障排查（AI 排查指引）

| 症状 | 原因 | 处理 |
|------|------|------|
| 窗口白屏 / 空白 | dsh 服务未启动 | 读日志定位：Windows `%APPDATA%/DeepSeek Harness/dsh-server.log`；macOS 用 `log show --predicate 'process == "dsh"'` |
| 启动报 Node 相关错误 | macOS 缺 Node 22+ | `node -v` 检查，装 v22+（如 nvm） |
| 模型报鉴权 / 401 | API Key 未配置 | 重做 3.2，确认环境变量可见 |
| 端口 3080 被占用 | 已有 dsh 实例 | 直接复用（应用会自动探测）；或 `lsof -ti:3080 \| xargs kill` 后重启 |
| 未签名警告 | 无开发者证书 | 按 3.1「未签名提示」处理 |

## 6. 从源码构建（开发者 / AI 可复现）

### macOS

```sh
cd macos
swiftc -O -o App/dsh Sources/main.swift -framework Cocoa -framework WebKit
mkdir -p App/dsh.app/Contents/MacOS App/dsh.app/Contents/Resources
cp App/dsh App/dsh.app/Contents/MacOS/
cp App/Info.plist App/dsh.app/Contents/Info.plist
codesign --force --sign - App/dsh.app
hdiutil create -volname "DeepSeek Harness" -srcfolder App/dsh.app -ov -format UDZO "App/DeepSeek Harness.dmg"
```

### Windows

```bash
cd windows
npm install
npm start          # 开发运行
npm run dist       # 打包 NSIS 安装程序（需 Electron ≥ 37，勿降级）
```

## 7. 仓库结构

```
dsh-desktop/
├── macos/      # Swift + WKWebView 实现（含构建脚本）
├── windows/    # Electron 便携实现（含 vendor 同步说明）
└── docs/       # 封面图等资源
```

## 8. 许可证

[MIT](LICENSE)
