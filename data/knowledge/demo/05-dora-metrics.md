# DORA Metrics 改善

DevOps 四大指標，PAAW 怎麼改善每一項：

## 1. Lead Time（交付時間）
- **傳統：** 天～週
- **PAAW：** 分鐘
- **原因：** App Builder 自動產出，自動註冊

## 2. Deploy Frequency（部署頻率）
- **傳統：** 週 / 月
- **PAAW：** 隨時
- **原因：** 不用部署，自動上線

## 3. Change Failure Rate（變更失敗率）
- **傳統：** 高
- **PAAW：** 低
- **原因：** Guardrails + Validation + deterministic

## 4. MTTR（平均修復時間）
- **傳統：** 小時
- **PAAW：** 分鐘
- **原因：** Skill 有 Error Handling，AI 可診斷
