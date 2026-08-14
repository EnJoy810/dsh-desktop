# dsh-desktop

**DeepSeek Harness 跨平台桌面应用**（macOS + Windows）。

DeepSeek Harness（`@deepseek-ai/dsh`）的桌面壳，支持自定义对话窗口背景、磨砂玻璃侧边栏、页面缩放快捷键。

## 平台目录

| 目录 | 平台 | 技术栈 | 说明 |
|------|------|--------|------|
| [`macos/`](macos/) | macOS | Swift + WKWebView | 原生应用，内嵌默认背景，`View > Change Background…`（⌘B）换背景 |
| [`windows/`](windows/) | Windows | Electron 33+ | 便携版：内置 dsh 运行时（`ELECTRON_RUN_AS_NODE`），无需安装 Node.js |

## 打包产物

- **macOS**：`macos/App/DeepSeek Harness.dmg`（`hdiutil` 制作，ad-hoc 签名）
- **Windows**：`windows/dist/DeepSeek Harness Setup *.exe`（NSIS 安装程序）

发布在 GitHub Releases：<https://github.com/EnJoy810/dsh-desktop/releases>

## 功能

- 自定义对话窗口背景（macOS：⌘B / Windows：Ctrl+B），选任意图片即时生效
- 背景持久化：macOS `~/Library/Application Support/DeepSeek/background.jpg`；Windows `%APPDATA%/DeepSeek Harness/background.jpg`，重启自动恢复
- 磨砂玻璃侧边栏（backdrop-filter）
- 页面缩放：macOS ⌘+/⌘-/⌘0；Windows Ctrl+/Ctrl-/Ctrl0

详见各平台目录内 README。
