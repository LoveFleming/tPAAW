# i18next rules removed（2026-10-02）

PAAW UI 不使用 i18next 框架（自建 t() + locale JSON）。
原規則對所有硬編碼 JSX 文字報 portability INFO（1185 筆），對本產品全是雜訊。
若未來引入 i18next，從 semgrep 官方 registry 恢復此規則夾。
