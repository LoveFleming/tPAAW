MXC 離線安裝包（公司 Linux 用，registry.npmjs.org 連不到時）

來源：registry.npmjs.org（官方原始 tarball，未改動）
內容（x64/）：
  microsoft-mxc-sdk-1.0.0.tgz          (= @microsoft/mxc-sdk@1.0.0)
  koffi-3.3.3.tgz
  koromix-koffi-linux-x64-3.3.3.tgz    (= @koromix/koffi-linux-x64@3.3.3)
  node-pty-1.1.0.tgz
  node-addon-api-7.1.1.tgz
  semver-7.7.4.tgz
（arm64/ 另附 koromix-koffi-linux-arm64-3.3.3.tgz）

用法（在 tPAAW 根目錄；先確認已裝 build-essential + python3）：
  # x64 機器：
  npm install ./vendor/mxc-offline/x64/*.tgz --no-save
  # arm64 機器：把上面的 x64 換 arm64，並另外放一份 koffi-linux-x64 不需要
  bash scripts/check-mxc-linux.sh      # 要看「MXC 就緒 ✅」

說明：這幾顆會裝到 node_modules 對應位置；node-pty 會在本機編譯（所以一定要 build-essential+python3）。
之後正常 `npm install` 若還是想從 mirror 抓，先設：
  npm config set @koromix:registry <公司mirror>
  npm config set @microsoft:registry <公司mirror>
