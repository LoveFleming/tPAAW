# App Training: skill-counting-report
## 報表設定
- Report 名稱: skill-counting-report
- Template: dashboard
- 基底 Skill: 
- 建立時間: 2026-06-01T17:45:00.000Z

## 訓練 Prompt
你是一個前端報表開發專家。請產出一個完整的 HTML 報表頁面。

## 報表規格
- Template 類型: dashboard
- 報表名稱: Skill Counting Report
- 資料來源: GET /api/skills 返回所有 skills，前端分類統計

## 技術要求
1. 純 HTML，所有 CSS 和 JS 都內聯
2. 用 Chart.js (CDN: https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js) 畫圖表
3. 風格：白色卡片 + stone 色系，圓角卡片佈局
4. 響應式設計

## 頁面結構

### Top Summary Cards (4 cards in a row)
- 總 Skill 數量
- Definition Skills 數量 (input-prompt type)
- Physical Skills 數量 (physical-skill type)  
- Training Skills 數量 (training type)

### Chart 1: Skill Type Distribution (Doughnut Chart)
- 分類：Definition Skills vs Physical Skills vs Training Skills
- 顏色：藍色系、綠色系、橘色系

### Chart 2: Skills by Category (Bar Chart)
- 將 skills 依照功能分組統計：
  - "Testing" 類：test-generation, test-design, skill-testing, java-unit-test, bug-review, quality-gate, spec-check
  - "Design" 類：skill-design, skill-creation, skill-forging, skill-packing, draft-flow-specs
  - "Diagnosis" 類：diagnosis, root-cause, incident-detection, incident-support, signal-detect, health-check-design
  - "API" 類：api-health-check, endpoint-probe, define-api-contracts, contract-validation
  - "Factory" 類：factory-constitution, factory-tour, aioc-tour, quick-tour, dashboard-setup
  - "Code Gen" 類：node-codegen, collect-inputs, extract-user-stories
  - "Monitoring" 類：sla-monitor
  - "CLI" 類：cli-test, claude-code-test, opencode-test
  - "Other" 類：其他

### Chart 3: Skill Growth Timeline (Line Chart)
- 用假數據模擬 skill 增長趨勢（按月份）

### Table: All Skills List
- 表格列出所有 skill
- 欄位：Name, Type, Category
- 可排序、可搜尋

## 資料獲取
頁面載入時 fetch `/api/skills`，API 返回格式：
```json
[
  { "id": "skill-name", "name": "Skill Name", "description": "...", "hasApp": false }
]
```
然後前端根據 skill 的屬性分類。由於 API 沒有直接給 type，用以下邏輯判斷：
- 已知 physical skills: daily-stats
- 其餘都是 definition skills (input-prompt)

## 重要
- 只輸出 HTML 代碼，不要用 markdown code block 包住
- 不要任何解釋，直接輸出完整 HTML
- HTML 開頭是 <!DOCTYPE html>
- 要漂亮，有動畫效果，數字要有 count-up 動畫
- 整體要像一個專業的 dashboard

## 測試 Prompt
幫我生成一個簡單的 skill counting bar chart，只統計 Definition Skills 和 Physical Skills 的數量，用 Chart.js 畫出來。假數據即可：34 個 Definition Skills、1 個 Physical Skills。
