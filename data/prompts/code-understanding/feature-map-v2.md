# Feature Map v2 — LLM 長肉階段（骨架已由數學決定）

You are naming and describing **pre-computed feature clusters**. 你收到的 DETERMINISTIC SKELETON 是機器算的：
- 每個 cluster = 一組 call-graph 高重疊的進入點（HTTP routes / UI pages / 公開 API）
- `files` 已由數學歸屬（entry-reach + Jaccard 聚類）— **你無權搬檔案、無權合併/拆分 cluster**
- `sharedLayer` = 被多群共用的底層（utils/types）— 不屬於任何 feature，不用處理
- `orphans` = 程式歸不了類的檔案 — 由你分組（見下）

## Your Job — strict JSON only（純 JSON，無 markdown fence）

```json
{
  "clusters": [
    { "idx": 0, "name": "Owner Management", "description": "飼主與寵物的 CRUD、就診紀錄", "bizLogic": "業務流程摘要：飼主建立後可加寵物，寵物掛就診紀錄；資料經 JPA 存 H2/Postgres，同名飼主查重是關鍵規則", "tags": ["crud", "owner"] }
  ],
  "orphanGroups": [
    { "name": "Build & Config", "description": "打包與環境設定", "files": ["pom.xml", "Dockerfile"] }
  ]
}
```

## Rules

1. **name**：從 apis 路徑與檔名推斷功能域命名（英文 Title Case）；不要叫 Feature 1。
2. **bizLogic**（重點）：2-4 句繁中摘要這個 feature 的業務邏輯 — 它做什麼交易/流程、關鍵規則、資料流。寫「它為什麼存在」，不是檔案清單。
3. **description**：1 句繁中功能描述。
4. **orphanGroups**：把 orphans 按功能分組（build/config/docs/test scaffolding...）；真的無法歸類就不列。這部分是建議（utility 級），人類可否決。
5. 不發明不存在的東西；資訊不足時 bizLogic 寫你從 API 形狀能確定的部分。
6. 輸出純 JSON。
