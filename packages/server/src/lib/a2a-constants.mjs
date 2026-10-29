/**
 * A2A Protocol constants — 單一真相來源。
 *
 * 由 routes/a2a.mjs 與 lib/domain-agent-registry.mjs 共用，
 * 避免兩處各自硬編 protocolVersion 造成漂移（QA-TASK052 M1）。
 * 獨立成檔以避免 a2a route 與 domain-agent-registry 之間的循環依賴。
 *
 * A2A 官方協定最新穩定版為 0.3.x，並無 1.0.0。
 */
export const A2A_PROTOCOL_VERSION = "0.3.0";
