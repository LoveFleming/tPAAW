# vitest envDir（2026-10-17）
# vite/vitest 啟動時會從 envDir 載入 .env 系列檔案；根目錄 .env 是 PAAW 沙箱機密防讀路徑
# （paaw-sandbox.mjs deniedPaths），導致沙箱內跑 vitest 必炸 EPERM → 被判 sandbox_fs_deny。
# envDir 指到這裡（不含任何機密）後，沙箱內外都能正常跑測試。
# 測試需要環境變數時：在測試內自行 process.env.x 或 mock，不要依賴根目錄 .env。
