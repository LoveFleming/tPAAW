---
id: skill-packing
name: Skill 打包
version: 1.0.0
description: 將 input-prompt skill 打包為可部署的 physical-skill package，含目錄結構、README、腳本範本
category: workflow
suggestedRoles:
  - AI Skill Designer
  - AI Skill Creator
tags:
  - skill
  - packing
  - package
  - deploy
  - physical-skill
userInputs:
  - id: target_skill_id
    label: 目標 Skill ID
    description: 要打包的技能 ID，必須已存在於 skills/input-prompt/
    placeholder: 例：skill-forging
    required: true
    type: text
    group: 📦 打包標的
  - id: include_scripts
    label: 包含腳本範本
    description: 是否產生 scripts/ 目錄和範本？適合需要自動化執行的技能
    placeholder: true / false
    required: false
    type: select
    values:
      - "true"
      - "false"
    group: ⚙️ 打包選項
  - id: include_references
    label: 包含參考資料
    description: 是否產生 references/ 目錄？適合需要附帶範例文件或 spec 的技能
    placeholder: true / false
    required: false
    type: select
    values:
      - "true"
      - "false"
    group: ⚙️ 打包選項
  - id: version_bump
    label: 版本號
    description: 打包時的版本號，留空則沿用原版本
    placeholder: 例：1.1.0
    required: false
    type: text
    group: ⚙️ 打包選項
---

# Skill 打包

## 目的
將 `input-prompt` 類型的 Skill 打包為 `physical-skill` package，產生完整的可部署目錄結構。打包後的 Skill 可以在離線環境使用，或作為獨立套件分發。

## 觸發時機
- Skill 已完成測試，準備部署
- 需要將 Skill 分享給其他 AI 軟體工廠
- Skill 需要附帶腳本或參考資料
- 建立 Skill 的正式發布版本

## 執行步驟

### 1. 驗證來源 Skill
- 確認 `skills/input-prompt/{target_skill_id}/SKILL.md` 存在
- 解析 frontmatter，確認格式正確
- 如果已經有 `skills/physical-skill/{target_skill_id}/`，詢問是否覆蓋
- 確認 Skill 已通過測試（建議先用 skill-testing 驗證）

### 2. 建立目錄結構
```
skills/physical-skill/{target_skill_id}/
├── SKILL.md          ← 完整技能定義（從 input-prompt 版本強化）
├── scripts/          ← 自動化腳本（如果 include_scripts=true）
│   ├── README.md     ← 腳本使用說明
│   └── run.sh        ← 主要執行腳本範本
├── references/       ← 參考資料（如果 include_references=true）
│   └── README.md     ← 參考資料說明
└── README.md         ← 技能概覽與使用指南
```

### 3. 強化 SKILL.md
在 physical-skill 版本的 SKILL.md 中加入：
- `kind: "physical-skill"`（覆蓋 input-prompt）
- `usePhysicalSkills: true` 標記
- 更新 `version`（如果有 version_bump）
- 在 body 中加入「部署方式」區塊
- 在 body 中加入「依賴」區塊（列出需要的 CLI 工具、環境）

### 4. 產生 README.md
```markdown
# {Skill Name}

> {description}

## 版本
v{version}

## 包含內容
- `SKILL.md` — 技能定義
- `scripts/` — 自動化腳本
- `references/` — 參考資料

## 使用方式
1. 將整個目錄複製到目標工廠的 `skills/physical-skill/` 下
2. 在員工的 skillIds 中加入 `{target_skill_id}`
3. 重新載入工廠設定

## 依賴
{根據技能內容列出}
```

### 5. 產生腳本範本（如果 include_scripts=true）
- `scripts/run.sh` — 執行腳本骨架
- `scripts/README.md` — 說明腳本用途和參數
- 根據 Skill 的 userInputs 產生對應的 CLI 參數解析

### 6. 產生參考資料目錄（如果 include_references=true）
- `references/README.md` — 說明應放什麼參考資料
- 根據 Skill 的 useSkills 列出相關技能連結

### 7. 驗證打包結果
- 確認目錄結構完整
- 確認 SKILL.md frontmatter 正確
- 確認 `GET /api/skills` 能列出 physical 版本
- 確認沒有遺漏檔案

### 8. 回報
```
📦 Skill 打包完成：{target_skill_id}
═══════════════════════════
來源：skills/input-prompt/{target_skill_id}/
目標：skills/physical-skill/{target_skill_id}/
版本：{version}

檔案清單：
  ✅ SKILL.md
  ✅ README.md
  ✅ scripts/run.sh
  ✅ scripts/README.md
  ✅ references/README.md

下一步：
  - 在 CrewEditor 中將此技能指派給員工
  - 或複製到其他工廠使用
```

## 產出
- `skills/physical-skill/{target_skill_id}/` — 完整的 physical skill package
- 打包報告（文字）

## Guardrails
- 不刪除或修改來源的 input-prompt 版本
- 如果 physical-skill 目錄已存在，必須確認覆蓋
- 版本號只能往上升，不能降級
- 打包不執行任何腳本，只建立檔案
- 所有路徑使用相對路徑，確保跨平台相容

## 品質檢查
- [ ] 目錄結構完整，沒有遺漏
- [ ] SKILL.md 的 kind 為 physical-skill
- [ ] README.md 包含使用方式
- [ ] 沒有硬編碼的絕對路徑
- [ ] `GET /api/skills` 能列出打包後的版本
