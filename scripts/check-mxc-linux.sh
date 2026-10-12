#!/usr/bin/env bash
# check-mxc-linux.sh — 檢查公司 Linux 的 Microsoft MXC 沙箱是否就緒
# 用法：在 PAAW 專案根目錄執行  ->  bash scripts/check-mxc-linux.sh
# 只檢查「有沒有裝好」，不會改任何東西。Linux 專用（讀 /proc）。

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
FAIL=0
ok()   { echo "${GRN}✅ $*${RST}"; }
bad()  { echo "${RED}❌ $*${RST}"; FAIL=1; }
warn() { echo "${YEL}⚠️  $*${RST}"; }

echo "== PAAW MXC 自檢 ($(date '+%Y-%m-%d %H:%M')) =="
if [ "$(uname -s)" = "Darwin" ]; then
  warn "本腳本是給公司 Linux 用的；macOS 走 srt 後端，下面的 bwrap/proc 紅字在這裡是正常的"
fi

# 0) 是否在專案根
if [ -f package.json ] && grep -q '"name"[[:space:]]*:[[:space:]]*"paaw"' package.json 2>/dev/null; then
  ok "在 PAAW 專案根目錄"
else
  warn "這裡好像不是 PAAW 根目錄（找不到 package.json name=paaw）— 請 cd 到 tPAAW 再跑"
fi

# 1) Node >= 24
NV="$(node --version 2>/dev/null || echo none)"
if [ "$NV" = "none" ]; then
  bad "找不到 node"
else
  MAJ="${NV#v}"; MAJ="${MAJ%%.*}"
  if [ "$MAJ" -ge 24 ] 2>/dev/null; then ok "Node $NV (>=24)"; else bad "Node $NV < 24 — mxc-sdk 需要 >=24，請升級（例：nvm install 24 && nvm use 24）"; fi
fi

# 2) mxc-sdk 本體
if [ -f node_modules/@microsoft/mxc-sdk/dist/v1/index.js ]; then
  ok "mxc-sdk 已安裝 ($(node -p "require('./node_modules/@microsoft/mxc-sdk/package.json').version" 2>/dev/null))"
else
  bad "mxc-sdk 未安裝 — 檢查 npm install 是否出現 EBADENGINE / node-pty 編譯錯誤（它只是 optional，失敗不會擋安裝）"
fi

# 3) 原生庫
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) D=x64 ;;
  aarch64|arm64) D=arm64 ;;
  *) D="" ;;
esac
if [ -n "$D" ] && [ -f "node_modules/@microsoft/mxc-sdk/bin/$D/libmxc_ffi.so" ]; then
  ok "原生庫 bin/$D/libmxc_ffi.so 存在"
else
  bad "找不到原生庫（bin/$D/libmxc_ffi.so）— mxc-sdk 沒裝好或平台不支援"
fi

# 4) bubblewrap（MXC Linux 後端）
if command -v bwrap >/dev/null 2>&1; then
  BV="$(bwrap --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [ -n "$BV" ] && [ "$(printf '%s\n0.5.0\n' "$BV" | sort -V | head -1)" = "0.5.0" ]; then
    ok "bubblewrap $BV (>=0.5.0)"
  else
    bad "bubblewrap ${BV:-未知} < 0.5.0（沙箱用到 --clearenv）"
  fi
else
  bad "沒裝 bubblewrap → sudo apt-get install -y bubblewrap"
fi
U="$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 0)"
if [ "$U" -gt 0 ] 2>/dev/null; then ok "user namespaces 可用 (max_user_namespaces=$U)"; else bad "user namespaces 可能關閉 (max_user_namespaces=$U)"; fi

# 5) LXC（bubblewrap 的替代，二擇一即可）
if command -v lxc-ls >/dev/null 2>&1; then ok "LXC 也在（lxc-ls）"; else warn "沒 LXC（有 bubblewrap 就夠）"; fi

# 6) 用 SDK 自己探測（最準）
echo "-- SDK 探測 getPlatformSupport() --"
OUT="$(node -e "import('@microsoft/mxc-sdk/v1').then(async m=>{const s=await m.getPlatformSupport();console.log(JSON.stringify(s,null,2));process.exit(s.isSupported?0:2)}).catch(e=>{console.error('LOAD FAILED:',e.message);process.exit(3)})" 2>&1)"
RC=$?
printf '%s\n' "$OUT" | sed 's/^/   /'
case "$RC" in
  0) ok "isSupported = true" ;;
  2) bad "isSupported = false（看上面 reason / unavailableReasons）" ;;
  3) bad "SDK 載入失敗（多半是 Node < 24 或 mxc-sdk 沒裝）" ;;
  *) warn "探測結果不明 (rc=$RC)" ;;
esac

echo
if [ "$FAIL" = 0 ]; then
  echo "${GRN}=== 結論：MXC 就緒 ✅ 啟動 PAAW 會自動走 MXC 後端 ===${RST}"
else
  echo "${RED}=== 結論：MXC 尚未就緒 ❌ 照上面紅字修 ===${RST}"
fi
echo "（提醒：MXC 不可用時 PAAW 仍可正常運作 — fallback 鏈 mxc→srt→原樣執行，pattern 掃描仍在）"
