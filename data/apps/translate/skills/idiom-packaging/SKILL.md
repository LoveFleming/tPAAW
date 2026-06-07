---
id: idiom-packaging
name: 特殊詞彙包裝
version: 1.0.0
description: 將翻譯中的特殊詞彙（成語、俚語、術語）包裝成經典例句或笑話，加深記憶
category: generation
suggestedRoles:
  - AI Factory Assistant
tags:
  - idiom
  - vocabulary
  - example
  - joke
userInputs:
  - id: word
    label: 特殊詞彙
    description: 要包裝的詞彙
    required: true
    type: text
    group: 📦 詞彙輸入
  - id: word_type
    label: 詞彙類型
    description: idiom, slang, jargon, culture, pun
    required: true
    type: text
    group: 📦 詞彙輸入
  - id: context
    label: 上下文
    description: 這個詞出現的原文句子
    required: false
    type: text
    group: 📦 詞彙輸入
  - id: target_lang
    label: 目標語言
    description: 例句要用的語言
    required: false
    type: text
    default: en
    group: 📦 詞彙輸入
useSkills: []
---

# Idiom Packaging Skill

## Purpose
把翻譯過程中發現的特殊詞彙（成語、俚語、術語、文化詞）包裝成好記的內容：經典例句 + 趣味笑話或記憶口訣，幫助使用者真正記住這個詞。

## Inputs
- `word` (必填)：特殊詞彙
- `word_type` (必填)：idiom | slang | jargon | culture | pun
- `context` (選填)：出現此詞的原文上下文
- `target_lang` (選填，預設 en)：目標語言

## Deterministic Script

### Tool Access
- AI 語言生成能力

### Execution Steps

1. **分類判斷**
   - 根據 `word_type` 決定包裝風格：
     - `idiom` → 經典文學例句 + 詞源故事
     - `slang` → 生活化例句 + 趣味用法
     - `jargon` → 專業例句 + 簡白解釋
     - `culture` → 文化背景 + 跨文化對比
     - `pun` → 雙關例句 + 笑話

2. **生成經典例句**
   - 必須用目標語言撰寫
   - 例句要自然、常用、能展現該詞彙的典型用法
   - 例句長度：1-2 句
   - 附上例句的中文翻譯

3. **生成趣味內容**
   - 二選一：
     - **笑話/趣味用法**：跟這個詞相關的幽默記憶法
     - **記憶口訣**：幫助記住這個詞的聯想方式
   - 必須有助於記憶，不只是搞笑
   - 如果有上下文 `context`，盡量跟上下文情境相關

4. **包裝輸出**
   - 詞彙 + 音標/讀音
   - 詞性 + 簡單定義
   - 經典例句（附翻譯）
   - 趣味內容

### Business Rules
- 例句必須是真的會用在日常或專業場景的，不是造作的自創句
- 笑話不能冒犯任何人或群體
- 文化詞要中立描述，不帶偏見
- 如果是成語，提供字面翻譯 + 實際含義

### Error Handling
- 詞彙不明確 → 要求更多上下文
- 類型不匹配 → 自動調整到最接近的類型
- 無法生成好的例句 → 提供詞典式的解釋即可

## Guardrails
- 不生成冒犯性、歧視性內容
- 例句品質 > 數量（寧可一個好例句，不要三個爛的）
- 保持教育性質，笑話是為了記憶服務

## Output Contract

```json
{
  "word": "break a leg",
  "phonetic": "/breɪk ə lɛɡ/",
  "part_of_speech": "idiom",
  "definition": "祝好運（特別用於表演前）",
  "classic_sentence": {
    "en": "You're going to be amazing tonight — break a leg!",
    "zh": "你今晚一定會很棒的——祝好運！"
  },
  "fun_fact": {
    "type": "joke|mnemonic|origin",
    "content": "為什麼表演前要說 break a leg？因為如果說 good luck，反而會帶來壞運氣！所以用反話來祝福。"
  }
}
```

## Validation
- 例句確實包含該詞彙
- 翻譯準確
- 趣味內容有助於記憶
- JSON 格式正確
