---
name: java-unit-test
description: 為 Java 程式碼撰寫 JUnit 單元測試
requiredInputs:
  - id: class_path
    label: 類別路徑
    description: 要測試的 Java 類別完整路徑
    placeholder: 例：src/main/java/com/example/UserService.java
    required: true
    group: 📋 Target
  - id: test_focus
    label: 測試重點
    description: 要特別關注的功能或方法
    placeholder: 例：login 方法的邊界條件
    required: false
    group: 🎯 Focus
  - id: test_framework
    label: 測試框架
    description: 使用的測試框架
    placeholder: JUnit 5 + Mockito
    required: false
    group: 🔧 Framework
---

# Java Unit Test Skill

## 目的
為指定的 Java 類別撰寫完整的 JUnit 單元測試。

## 流程
1. 閱讀目標類別的原始碼，理解所有公開方法
2. 識別每個方法的正常路徑和邊界條件
3. 為每個方法設計測試案例（happy path + edge cases + error cases）
4. 撰寫測試程式碼，使用 JUnit 5 + Mockito
5. 確保測試命名清楚：should_ExpectedBehavior_When_Condition

## 產出
- 完整的 JUnit 測試類別
- 測試覆蓋正常路徑、邊界條件、例外處理
- 適當的 mock 設定
- 清楚的測試命名

## Guardrails
- 每個測試只測一個行為
- 不要測試 private 方法
- 使用 @DisplayName 標註測試用途
- Mock 外部依賴，不要 mock 被測試的類別本身
