# 任務：為「{{num}}. {{title}}」section 撰寫 Product Spec 初稿

你在為一個既有 codebase 反向生成 Product Spec（AI-Native Product Development Specification）。

## Section 定義

- 編號：{{num}}
- 標題：{{title}}
- 內容範圍：{{zh}}
- 主要負責：{{owner}}

## 撰寫規則

1. **evidence 優先**：下方 EVIDENCE 是 deterministic 產出（scan / feature map / api map / test intelligence 等），所有 API、feature、測試事實**只能來自這裡**，不可發明。evidence 沒有的細節，用「待確認」標示。
2. **輸出格式**：純 markdown，第一行是 `# {{num}}. {{title}}`（H1），其下用 H2/H3 分小節。可用表格（GFM）。**不要**輸出 code fence 包整份內容。
3. **繁體中文撰寫**，技術名詞保留英文（如 API、Timeout、Prometheus）。
4. **初稿心態**：這是給架構師跟人討論的草稿（Status: Draft），不是最終文件 — 內容要具體、可討論、可反駁，不要空話。
5. 長度：精實為上，每個小節講清楚就好；evidence 豐富的 section 可以長，證據少的 section 短而誠實（多標「待確認」）。

直接輸出 section 內容（以 H1 開頭），不要前言後語。
