# 我的記憶

## 專案慣例
- Night Shift 三模組架構：overnight-manager.mjs（調度引擎）、night-shift-shared.mjs（共用工具）、coding-night-shift.mjs（route 層）
- ADR 編號目前到 ADR-009b，下一個是 ADR-010
- commit message 用繁中，描述清楚變更內容
- 絕對不 push，只 commit

## 踩過的坑
- (尚無)

## 使用者偏好
- (尚無)

## 架構觀察
- overnight-manager.mjs:354 有 lib→route 反向依賴（import coding-night-shift-prompts.mjs），是技術債
- coding.mjs:787 有 legacy `/api/coding-crew/em-run` route，仍直接呼叫 runEMSession，繞過 coding-night-shift.mjs 統一入口
- getPromptsFile 定義在 route 層但被 lib 層引用，應下沉到 shared
