MXC 離線安裝包（公司 Linux 用，連不到 registry.npmjs.org 時）

來源：registry.npmjs.org（官方原始 tarball，未改動；附 SHA256SUMS 可核對）

相對路徑 → 對應套件：
  x64/microsoft-mxc-sdk-1.0.0.tgz        → @microsoft/mxc-sdk@1.0.0
  x64/koffi-3.3.3.tgz                    → koffi@3.3.3
  x64/koromix-koffi-linux-x64-3.3.3.tgz  → @koromix/koffi-linux-x64@3.3.3
  x64/node-pty-1.1.0.tgz                 → node-pty@1.1.0
  x64/node-addon-api-7.1.1.tgz           → node-addon-api@7.1.1
  x64/semver-7.7.4.tgz                   → semver@7.7.4
  arm64/koromix-koffi-linux-arm64-3.3.3.tgz → @koromix/koffi-linux-arm64@3.3.3
（x64 的 5 顆共用檔在 arm64 機器也通用；只有 koffi 平台包分 arch）

用法（tPAAW 根目錄；前置：build-essential + python3）：
  1) 把 vendor/mxc-offline/ 整包放進 tPAAW
  2) bash scripts/install-mxc-offline.sh        # 自動挑 arch + 校驗 + 安裝 + 驗證
  3) bash scripts/check-mxc-linux.sh            # 要看到「MXC 就緒 ✅」

不想用 script 就手動（x64）：
  npm install ./vendor/mxc-offline/x64/*.tgz --no-save

長期解：請管 mirror 的人把 @microsoft / @koromix 兩個 scope 加進上游 proxy。
