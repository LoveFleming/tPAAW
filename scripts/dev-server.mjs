/**
 * PAAW Dev Instance Entry Point
 *
 * Starts PAAW on alternative ports (from .env.dev) so it doesn't conflict
 * with the main PAAW instance. Used for dogfooding — developing PAAW
 * inside PAAW's own Coding App.
 *
 * Usage: node scripts/dev-server.mjs
 *        npm run dev:alt:server
 */

process.env.PAAW_ENV = process.env.PAAW_ENV || "dev";

import("../packages/server/src/paaw-server.mjs");
