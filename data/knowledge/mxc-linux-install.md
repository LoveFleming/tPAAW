# MXC 沙箱 — 公司 Linux 安裝實戰

> 2026-10-12 版。對應實作：`packages/server/src/lib/paaw-sandbox.mjs`、`scripts/check-mxc-linux.sh`、`scripts/install-mxc-offline.sh`。
> 一句話：**`npm install` 沒報錯 ≠ MXC 裝好了** —— optionalDependencies 會靜默失敗。

---

## MXC 是什麼、為什麼要裝

- **MXC = Microsoft eXecution Container**（`@microsoft/mxc-sdk`），PAAW 的 Linux / Windows 沙箱後端。
- 後端選擇 `PAAW_SANDBOX_BACKEND=auto`：**macOS → srt（Seatbelt）**、**win32 / linux → mxc**。
- fallback 鏈：**`mxc → srt → raw（原樣執行）`**；不可用時**靜默降級、不報錯**。
- 逃生口：`PAAW_SANDBOX=off`（整關）。
- **沒裝 MXC，PAAW 照常運作**，只是少了 OS 層攔截（讀機密檔 / 連外網只剩 script-guard 的 pattern 掃描）。

---

## 硬性前置需求（公司 Linux）

| 項目 | 需求 | 檢查 |
|---|---|---|
| Node.js | **≥ 24**（`mxc-sdk` engines 寫死 `>=24.0.0`） | `node --version` |
| 編譯工具 | `build-essential` + `python3` | `which python3 make g++ gcc` |
| bubblewrap | **≥ 0.5.0**（用到 `--clearenv`） | `bwrap --version` |
| user namespaces | 開啟 | `cat /proc/sys/user/max_user_namespaces` > 0 |
| LXC | 選配（有 bubblewrap 就夠） | `lxc-ls --version` |

```bash
sudo apt-get install -y build-essential python3 bubblewrap
```
> ⚠️ **Node 太舊（如 v22）時 npm 預設不強制 engines**，會照裝但 runtime 掛 → `mxcAvailable()` catch → 靜默 fallback。**一定要升到 Node 24**（nvm：`nvm install 24 && nvm alias default 24`）。

---

## 症狀 → 真因對照（踩過的坑）

### 症狀 1：`npm install` 沒報錯，但 `node_modules/@microsoft/` 是空的
- **真因**：`@microsoft/mxc-sdk` 是 **`optionalDependencies`** → 子樹任一環失敗，npm **靜默丟掉整棵樹**。
- 檢查：`npm ls @microsoft/mxc-sdk`（有 `UNMET OPTIONAL DEPENDENCY` = 沒裝到）。

### 症狀 2：`tree-sitter-rust ... command failed`
- **真因**：缺編譯工具（`node-gyp` 跑不動）。裝 `build-essential python3` 即解。
- 註：`tree-sitter-rust` 其實有帶 linux prebuild，會退到編譯代表工具鏈沒齊。

### 症狀 3：verbose log 出現 `reify failed ... koromix koffi`
- **真因**：`mxc-sdk` 依賴 `koffi`，其平台包 `@koromix/koffi-linux-x64` 沒抓下來。

### 症狀 4：`node-pty` 的 `prebuilds/linux-x64 does not exist`
- **⚠️ 這不是錯誤**：`node-pty@1.1.0`（mxc-sdk 內建）的 tarball **只有 darwin/win32 prebuild**，Linux 找不到 prebuild 就**自動改走 `node-gyp rebuild`**（`scripts/prebuild.js` 的設計）。
- **真因**：後面那步 gyp 編譯失敗（缺工具鏈）。

### 症狀 5：`npm pack <pkg>` 抓得到，但 `npm install` 不行
- **`npm pack`** = 只抓那一顆 tarball（問 registry 要檔），**不讀 lockfile、不跑 build、不動相依樹**。
- **`npm install`** = 照 `package-lock.json` 的 `resolved` 網址抓檔 **＋ 跑 install 腳本（gyp 編譯）＋ reify 整棵樹**。
- 所以「tarball 抓得到」但「install 失敗」= 卡在 **build（gyp）** 或 **optional 靜默丟棄**。

---

## 診斷指令（由淺到深）

```bash
# 1. 有沒有裝到
npm ls @microsoft/mxc-sdk

# 2. metadata vs tarball 落點
npm view @microsoft/mxc-sdk version          # 有沒有登記
npm view @microsoft/mxc-sdk dist.tarball     # tarball 指哪個 host（指 registry.npmjs.org = 公司可能連不到）
npm pack @microsoft/mxc-sdk@1.0.0            # 真的下載一次（最準）

# 3. install 到底哪裡炸（抓關鍵字）
npm install --foreground-scripts --loglevel verbose 2>&1 \
  | grep -iE "mxc|koffi|koromix|node-pty|gyp|reify failed|EBADENGINE|404|ENOTFOUND|EAI_AGAIN|ECONNREFUSED" | tail -40
#   gyp/command failed      → 編譯問題（缺 build-essential/python3）
#   E404/ENOTFOUND/EAI_AGAIN → registry 連不到（mirror 沒 proxy，或 lock 的 resolved 指 npmjs）

# 4. 全項自檢（紅綠結論）
bash scripts/check-mxc-linux.sh
```

---

## 解法

### A. 先正規裝（能連 registry 的話）
```bash
sudo apt-get install -y build-essential python3 bubblewrap
# Node 若 <24 先升 24
rm -rf node_modules && npm install
bash scripts/check-mxc-linux.sh      # 要看到「MXC 就緒 ✅」
```

### B. 免編譯：把 node-pty 統一成有 linux prebuild 的版本（推薦）
- 事實：`mxc-sdk` 要 `node-pty@^1.1.0`（**沒 linux prebuild**），但 PAAW `packages/server` 本來就用 `node-pty@^1.2.0-beta.13`（→ **1.2.0-beta.15，有 linux prebuild**）。
- 在 root `package.json` 的 `overrides` 加 `"node-pty": "1.2.0-beta.15"` → 全樹統一 → **完全免 gyp 編譯**。

### C. mirror 沒 proxy `@microsoft` / `@koromix` scope → 離線包
- `deploy6` 的 `vendor/mxc-offline/`（官方原始 tarball + SHA256）：
  ```bash
  npm install ./vendor/mxc-offline/x64/*.tgz --no-save     # x64；arm64 換 arm64/ 的 koffi 平台包
  # 或
  bash scripts/install-mxc-offline.sh
  ```
- 長期解：請管 mirror 的人把 `@microsoft` / `@koromix` 兩 scope 加進上游 proxy。
- 若 mirror 只回 metadata、tarball 卻指 `registry.npmjs.org`：可 `npm config set replace-registry-host always` 或重生 lock。

---

## 驗證：`scripts/check-mxc-linux.sh` 判讀

- 全綠 = MXC 就緒 ✅
- **「沒 LXC」是 ⚠️ 警告、不是錯** —— 有 **bubblewrap 就夠**。
- 最後看 `getPlatformSupport()`：`isSupported: true` 且 `availableMethods` 含 `bubblewrap`。

---

## 實戰結果（2026-10-12，公司 Linux）

- 症狀：`npm install` 無錯但 `@microsoft` 空 → 追到 `node-pty@1.1.0` 無 linux prebuild + 缺 `build-essential/python3`。
- 裝完工具鏈後：**自檢全綠，僅 LXC 未裝（有 bubblewrap，OK）→ MXC 就緒**。
- 帶走的心法：
  1. **只信 `npm ls`**，不信「npm install 沒報錯」。
  2. `npm pack` OK ≠ install OK（差在 build 與 optional 靜默丟棄）。
  3. MXC 上不了 = PAAW 照跑但靜默降級 → **一定要跑自檢確認**。
