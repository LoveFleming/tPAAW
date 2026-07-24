---
name: payment-service-troubleshooting
category: kubernetes
severity: high
tags: [payment, connection-pool, database, 5xx]
summary: payment-service 5xx 飆高或 connection pool 耗盡的排查流程
---

# SOP: payment-service 排查

## 症狀
- payment-service 5xx 錯誤率 > 1%
- p99 latency > 1s
- 出現 "connection pool exhausted" log

## 排查步驟

### 1. 確認問題範圍
```promql
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{service="payment"}[5m]))
```
- 如果 p99 > 1s → 繼續步驟 2
- 如果正常 → 可能是暫時性問題

### 2. 檢查 Connection Pool
```promql
pg_connection_pool_active{service="payment"} / pg_connection_pool_max{service="payment"}
```
- 如果使用率 > 80% → connection pool 耗盡，繼續步驟 3
- 如果正常 → 檢查其他資源

### 3. 處置方案

#### 方案 A：重啟 connection pool（低風險）
```bash
kubectl rollout restart deployment/payment-service -n production
```
- 影響：短暫 30 秒不可用
- Rollback：不需要

#### 方案 B：擴大 pool size（中風險）
修改 ConfigMap：
```bash
kubectl edit configmap payment-service-config -n production
# DB_POOL_SIZE: 20 → 50
kubectl rollout restart deployment/payment-service -n production
```

#### 方案 C：擴容 pods（降負載）
```bash
kubectl scale deployment/payment-service --replicas=6 -n production
```

## Rollback
```bash
kubectl rollout undo deployment/payment-service -n production
```

## 升級條件
- 處置後 5 分鐘內未恢復 → P0，通知 on-call
- 影響交易 → P0，立刻通知付費團隊
