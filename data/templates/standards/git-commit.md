# Git Commit 規範

## Commit Message 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Type

| Type | 說明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `refactor` | 重構（不改行為） |
| `docs` | 文件 |
| `style` | 格式調整（不改邏輯） |
| `test` | 測試 |
| `chore` | 雜務（dependency update, config 等） |
| `perf` | 效能改善 |

## 規則

1. **subject 不超過 50 字** — 用英文寫，動詞開頭
2. **body 解釋「為什麼」** — 不是「做了什麼」（diff 已經說了做什麼）
3. **一個 commit 一件事** — 不要把無關的改動塞在一起
4. **改完碼一定要 commit + push** — 不留 uncommitted local change

## 範例

```
feat(coding-ide): add .paaw/ project knowledge tree

Adds PaawTree component to sidebar, PaawProject class for managing
project knowledge directory, and Agent Loop integration for automatic
context injection and session recording.

Closes #42
```

```
fix(chat): handle IME composition in message input

The Enter key was submitting the form during Chinese/Japanese input
composition. Use useRef to track composition state with triple
fallback protection.
```

## Branch 命名

- `feature/<short-desc>` — 新功能
- `fix/<short-desc>` — 修 bug
- `refactor/<short-desc>` — 重構

## ⚠️ 同步紀律

**改完碼 → commit → push → 才算完成**

原因：公司 Windows/Linux 跟 Mac mini 都從 repo pull，local fix 沒 push = 別人跑舊碼。
