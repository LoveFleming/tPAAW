# Skill 執行規則

## Crew Skill 使用方式

當 Crew 被分配 Skill 時，prompt 只會提供 Skill 名稱和 SKILL.md 的**絕對路徑**。

### 執行步驟

1. 看到 `請使用 {skill name}` + `skill path : {path}` 時
2. 用 `file_read` 讀取該 SKILL.md 路徑（路徑是絕對路徑，直接使用）
3. 理解 Skill 定義（Purpose、Inputs、Execution Steps、Output Contract）
4. 按照定義執行任務

### 注意事項

- **不要**猜測 Skill 內容，務必先讀取
- **路徑是絕對路徑**，不需要再加前綴或 resolve
- 讀取後按照 SKILL.md 的 Execution Steps 執行
- 如果 SKILL.md 有 Output Contract，輸出必須符合
- **Output Mode**：看 SKILL.md 的 Output Contract 宣告 `file` / `display` / `both`：
  - `file` → 一定要寫檔案
  - `display` → 直接在回應中顯示結果
  - `both` → 有 output_path 存檔，沒有就顯示
- user input 會接在 prompt 最後面
