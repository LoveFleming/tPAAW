# Quick Tour — AIEOC 使用指南

歡迎使用 **AIEOC (AI Engineering Operating Center)**。

> AI 進駐工程環境，協助建立工程秩序與品質治理。

---

## 核心精神

> AIEOC 不是讓 AI 自由寫程式，
> 而是讓 AI 在規範和制度的約束下，
> 協助建立工程秩序與品質治理。

導入創新，萬機皆服務，萬事皆連結。

---

## 1. Skills 是最重要的資產

AIEOC 最核心的功能是 **讓你分門別類累積建立自己的 Skills**。

Skill 是什麼？就是你讓 AI 做事的方法論：

- 你怎麼分析一個 code base
- 你怎麼建立測試
- 你怎麼做 code review
- 你怎麼排錯
- 你怎麼部署

這些方法論，就是你的工程智慧。AIEOC 幫你把這些智慧變成可重用、可分享的 Skill。

### Skill 生命週期

1. **發現問題** — 你找到一個反覆出現的工程問題
2. **建立 Skill** — 把解法寫成結構化的 SKILL.md
3. **指派給 AI 員工** — 讓對應角色的 AI 使用這個 Skill
4. **持續累積** — 每次使用可以優化，越來越精準
5. **跨專案重用** — 同一個 Skill 可以套用到不同 code base

> **Skills 是你的工程資產。** 寫程式的 AI 滿街都是，但你的 Skills 別人沒有。這才是 AIEOC 的價值。

### Skill Input — 給 AI 明確的指令

每個 Skill 執行時，你需要提供 **Input**，告訴 AI 這次要處理什麼。好的 Input 讓 AI 產出更精準：

- **具體明確** — 「分析 src/services/ 下的錯誤處理」比「看一下程式碼」好得多
- **提供脈絡** — 說明目標、範圍、限制條件
- **可重複使用** — 輸入過的 Input 會自動保留，下次可以直接選取重用

在員工工作區啟動 Skill 時：

1. 如果 Skill 有定義必填欄位，會跳出 **Input 對話框** 讓你填寫
2. 填完後點 **啟動**，AI 就會帶著你的 Input 開始工作
3. 過去填過的 Input 會顯示在 **「已存輸入」** 下拉選單，可以直接選取

> 💡 把你每次成功讓 AI 產出好結果的 Input 記下來，這就是你的最佳實務。AIEOC 會自動幫你保留這些輸入。

---

## 2. AI 員工團隊

AI 員工是 Skills 的載體。每位員工有明確的角色定位，負責執行特定類型的 Skill。

目前系統內建的員工展示了一個軟體開發團隊的基本成員：

| 員工 | 角色 | 說明 |
|------|------|------|
| 小春 林 | AI Skill Designer | 負責設計和建立 Skills |
| 林語晴 | Factory Guide | 工廠導覽、引導使用者 |
| 陳哲宇 | Spec Architect | 需求分析、API 合約 |
| 安妮卡 | Node Developer | 節點開發、Contract 驗證 |
| 彼得 | QA Engineer | 品質保證、測試設計 |
| 蘇菲亞 | Troubleshooting Engineer | 故障排除、根因分析 |

> ⚠️ 以上員工的 Skills 尚未完全建立，目前是展示用途。**你應該根據自己的需求，為每位員工建立真正可用的 Skills。**

### 如何新增員工與建立 Skills

1. 點左側 **AI Crew** 進入團隊頁面
2. 點選任一員工卡片上的 **「新增」按鈕** — 可以建立新的 AI 員工，設定名稱、角色、專長
3. 點選員工卡片上的 **「編輯」按鈕** — 可以修改員工資料、管理其 Skills 清單
4. 在編輯模式下可以新增或移除 Skills，讓員工具備你需要的能力
5. Skills 的詳細定義檔放在 `skills/` 目錄下，每個 Skill 是一個資料夾加上 `SKILL.md`

> 💡 **建議流程**：先想好你需要解決什麼問題 → 新增對應角色的員工 → 為他建立專屬的 Skill → 反覆使用和優化。Skills 不用一次到位，邊用邊改才是正確的累積方式。

---

## 3. 如何開始？

### Step 1：選擇 Project

啟動後輸入你的專案路徑（或點資料夾選擇器），進入 Dashboard。

### Step 2：認識介面

- **Header** — 頂部標題列，右側可切換主題
- **Sidebar（左側）** — Factory 文件、AI Crew、Code Base 檔案樹
- **Tabs（上方）** — 開啟的頁面分頁，點擊切換
- **工作區（中間）** — 主要操作區域，顯示目前選中的頁面內容
- **Switch Project（左下）** — 切換到其他專案

### Step 3：使用 AI 員工

點左側 **AI Crew** → 選擇一位 AI 員工 → 進入工作區：

1. **選擇 Skills** — 勾選要使用的技能
2. **填寫 Input** — 輸入任務需求
3. **啟動** — 選擇 CLI（Qwen / Claude / OpenCode），開始工作
4. **Console** — 即時查看 AI 執行過程，支援全螢幕模式

---

## 4. 主題色系 — 舒緩杏仁核

點右上角的主題按鈕，切換不同色系。不同色系可以舒緩不同的杏仁核狀態：

| 主題 | 適用情境 |
|------|---------|
| ☀️ 陽光 | 好心情、日常使用 |
| 🌤️ 藍天 | 輕鬆愉快 |
| 🌊 舒緩焦慮 | 停不下來、擔心未來 |
| 🌲 舒緩緊張 | 被 deadline 追著跑 |
| 🪵 舒緩憤怒 | 容易 irritated |
| ☕ 舒緩疲憊 | 腦袋累、被掏空 |
| 🔮 靈感爆發 | 創造力爆發 |

---

## 5. Console 全螢幕

在 Console 區域右上角有 **全螢幕按鈕**（展開圖示）：

- 點一下 → Console 全螢幕顯示
- 再按一下或按 **ESC** → 退出全螢幕

---

## 6. 跨 CLI 使用

AIEOC 支援多種 AI coding CLI，設定檔統一在 `providers/` 目錄：

- 用 Qwen：`cd /path/to/aieoc && qwen`
- 用 Claude Code：`cd /path/to/aieoc && claude`
- 用 OpenCode：`cd /path/to/aieoc && opencode`

所有 CLI 共用同一份 `skills/`，零設定直接使用。

---

## 7. 目錄結構

- **core/** — Dashboard 主程式
- **crew/** — AI 員工定義
- **factory/** — 工廠文件
- **skills/** — AI 技能（只一份，最重要的資產）
- **providers/** — CLI 設定
- **conversations/** — 對話和工作紀錄
