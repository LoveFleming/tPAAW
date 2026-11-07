#!/usr/bin/env bash
# install-mxc-offline.sh — 用 deploy6 附的 vendor/mxc-offline/ 離線安裝 MXC 相關套件
# 適用：公司機連不到 registry.npmjs.org（mirror 沒 proxy @microsoft / @koromix scope）
# 用法：在 tPAAW 根目錄執行  ->  bash scripts/install-mxc-offline.sh
# 前置：已裝 build-essential + python3（node-pty 要在本機編譯）
set -euo pipefail
cd "$(dirname "$0")/.."   # 切到 tPAAW 根

VOL="vendor/mxc-offline"
[ -d "$VOL" ] || { echo "❌ 找不到 $VOL/ — 請先把 deploy6 的 vendor/mxc-offline/ 整包放到 tPAAW 下"; exit 1; }

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) D=x64 ;;
  aarch64|arm64) D=arm64 ;;
  *) echo "❌ 不支援的 arch: $ARCH"; exit 1 ;;
esac

# 平台無關的共用檔放 x64/；平台專屬用 koromix-koffi-linux-<arch>
COMMON="$VOL/x64"
PLAT="$VOL/$D"
[ -d "$PLAT" ] || { echo "❌ 找不到平台目錄 $PLAT/"; exit 1; }

TGZ=()
while IFS= read -r f; do TGZ+=("$f"); done < <(ls -1 "$COMMON"/*.tgz 2>/dev/null | grep -v 'koromix-koffi-linux' || true)
while IFS= read -r f; do TGZ+=("$f"); done < <(ls -1 "$PLAT"/koromix-koffi-linux-*.tgz 2>/dev/null || true)

echo "== 使用 arch=$ARCH，安裝以下 tarball =="
printf '  %s\n' "${TGZ[@]}"

if [ -f "$VOL/SHA256SUMS.txt" ]; then
  echo "== 校驗 SHA256 =="
  ( cd "$VOL" && { sha256sum -c SHA256SUMS.txt 2>/dev/null || shasum -a 256 -c SHA256SUMS.txt 2>/dev/null; } ) || echo "⚠️  SHA 校驗有問題（仍繼續，但請留意）"
fi

echo "== npm install =="
npm install "${TGZ[@]}" --no-save

echo "== 驗證 =="
ls "node_modules/@microsoft/mxc-sdk/bin/$D/libmxc_ffi.so" && echo "✅ 原生庫到位" || echo "❌ 找不到 libmxc_ffi.so"
node -e "import('@microsoft/mxc-sdk/v1').then(()=>console.log('✅ mxc-sdk LOAD OK')).catch(e=>console.log('❌ LOAD FAIL:',e.message))"
echo
echo "下一步：bash scripts/check-mxc-linux.sh   （要看到「MXC 就緒 ✅」）"
