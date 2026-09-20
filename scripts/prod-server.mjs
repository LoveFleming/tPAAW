/**
 * PAAW Production Instance Entry Point
 *
 * Starts PAAW on production ports (from .env.prod, 預設 4399/4400) so it
 * doesn't conflict with the dev instance (4097/4098 from .env).
 *
 * 用法: node scripts/prod-server.mjs
 *       npm run start:prod
 *
 * UI 由本 server 直接 serve（packages/ui/dist），前端 same-origin 偵測 port，
 * build 不需要指定 PAAW_PORT — 跟 dev 共用同一份 dist 即可。
 */

process.env.PAAW_ENV = process.env.PAAW_ENV || "prod";

import("../packages/server/src/paaw-server.mjs");
