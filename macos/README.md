# macOS 版（Swift + WKWebView）

DeepSeek Harness 的 macOS 原生桌面客户端。

- **技术栈**：Swift + WKWebView，无 Electron，无第三方运行时
- **安装包**：`DeepSeek.Harness.dmg`（`hdiutil` 制作，ad-hoc 签名）

## 安装

1. 从 [Releases](https://github.com/EnJoy810/dsh-desktop/releases) 下载 `DeepSeek.Harness.dmg`
2. 双击挂载，将 **DeepSeek.app** 拖入「应用程序」
3. 首次打开：右键 → 打开（未签名应用需手动放行）

## 使用

| 操作 | 快捷键 |
|------|--------|
| 更换背景 | `⌘B`（菜单 View → Change Background…） |
| 恢复默认背景 | 菜单 View → Reset Background |
| 放大 / 缩小 / 还原 | `⌘+` / `⌘-` / `⌘0` |
| 重新加载 | `⌘R` |

背景缓存在 `~/Library/Application Support/DeepSeek/background.jpg`，重启自动恢复。

## 从源码构建

```sh
# 编译
swiftc -O -o App/dsh Sources/main.swift -framework Cocoa -framework WebKit

# 组装 .app bundle
mkdir -p App/dsh.app/Contents/MacOS App/dsh.app/Contents/Resources
cp App/dsh App/dsh.app/Contents/MacOS/
cp App/Info.plist App/dsh.app/Contents/Info.plist
cp Assets/icon.iconset/*.png App/dsh.app/Contents/Resources/ 2>/dev/null || true
codesign --force --sign - App/dsh.app

# 制作 dmg
hdiutil create -volname "DeepSeek Harness" -srcfolder App/dsh.app -ov -format UDZO "App/DeepSeek Harness.dmg"
```

## 工作原理

- 启动时探测 `http://127.0.0.1:3080`，若无服务则 spawn
  `node <npx缓存>/@deepseek-ai/dsh/lib/bin.js web --port 3080` 子进程
- WKWebView 加载 dsh Web UI，注入背景 / 磨砂 / 换背景 CSS
- 退出时终止子进程，释放端口

## 文件结构

```
Sources/main.swift        应用主体：窗口、菜单、进程管理、背景注入、换背景
Sources/make_icon.swift   图标生成器（一次性）
App/Info.plist            bundle 清单
App/bg.jpg / bg_small.jpg 默认奶鲸背景（base64 内嵌进 main.swift）
```
