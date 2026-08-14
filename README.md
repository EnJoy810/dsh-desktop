# dsh macOS Desktop App

Native macOS wrapper for DeepSeek Harness web UI (WKWebView, no Electron).

## How it works

- App launch → probes `http://127.0.0.1:3080` → if nothing is serving, spawns
  `node <npx-cache>/@deepseek-ai/dsh/lib/bin.js web --port 3080` as a child
  process (deliberately avoids `npx -y` so a patched local bundle is reused)
- Loads the UI in an embedded WKWebView window
- App quit → child server process is terminated (port released)

## Files

```
Sources/main.swift        app: window, menu, process lifecycle, port probe
Sources/make_icon.swift   icon renderer (AppKit, one-off)
App/Info.plist            bundle manifest (ad-hoc signed, local-only)
App/dsh.app               built bundle
```

## Rebuild

```sh
swiftc -O -o App/dsh Sources/main.swift -framework Cocoa -framework WebKit
mkdir -p App/dsh.app/Contents/MacOS App/dsh.app/Contents/Resources
cp App/dsh App/dsh.app/Contents/MacOS/
cp App/Info.plist App/dsh.app/Contents/Info.plist
# regenerate icon if changed:
swiftc -O -o Assets/make_icon Sources/make_icon.swift -framework AppKit
./Assets/make_icon Assets/icon.iconset/icon_1024x1024.png && iconutil -c icns Assets/icon.iconset -o App/dsh.app/Contents/Resources/AppIcon.icns
codesign --force --sign - App/dsh.app
```

## Install

```sh
cp -R App/dsh.app ~/Applications/
open ~/Applications/dsh.app
```

## Notes / trade-offs

- Ad-hoc signature only; Gatekeeper may warn on machines without the local
  build. Re-sign on each machine (or `xattr -dr com.apple.quarantine`).
- WKWebView has no devtools; View → Toggle Developer Tools opens the page in
  the default browser instead.
- If another process already serves port 3080, the app just attaches to it.
- Server uses the cached `@deepseek-ai/dsh` bundle in `~/.npm/_npx`; if npx
  re-downloads (cache cleared), a patched `dsh-llm-pi-ai` would be lost —
  rebuild the bundle before launching.
