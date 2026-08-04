/**
 * coding-auto-dispatch-config.mjs — Auto Dispatch 設定 API
 *
 * GET  /api/coding-auto-dispatch/config   — 取得設定
 * POST /api/coding-auto-dispatch/config   — 更新設定
 *
 * 設定存在 .paaw/auto-dispatch/config.json:
 * {
 *   "mode": "em",  // "em" = EM 智慧調度, "parallel" = 全員平行
 *   "schedule": { "enabled": true, "time": "22:00", "tz": "Asia/Taipei" },
 *   "model": { "primary": "zai/glm-5.1", "fallbacks": ["openrouter/z-ai/glm-5.1"] },
 *   "tasks": ["feature-map-refresh", "security-scan", "code-intelligence", "test-intelligence", "change-intelligence"]
 * }
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PORT } from './shared.mjs';

const PROJECT_PHASES = {
  'bootstrap': { label: '🚀 Bootstrap — 初始搭建', desc: '專案剛起步，大量 vibe coding，功能優先' },
  'mvp': { label: '📦 MVP — 最小可行產品', desc: '核心功能開發中，快速迭代' },
  'growth': { label: '📈 Growth — 功能擴展', desc: '功能穩定擴展中，開始補測試' },
  'stable': { label: '✅ Stable — 穩定維護', desc: '功能穩定，重視品質和文件' },
  'refactor': { label: '🔧 Refactor — 重構期', desc: '大規模重構，注意不要打壞舊功能' },
};

const DEFAULT_CONFIG = {
  mode: 'em',  // "em" = EM 智慧調度, "parallel" = 全員平行
  projectPhase: 'bootstrap',  // 專案階段 — 決定夜間排班策略
  schedule: {
    enabled: false,
    time: '22:00',
    tz: 'Asia/Taipei',
  },
  model: {
    primary: '',
    fallbacks: [],
  },
  tasks: [
    'feature-map-refresh',
    'security-scan',
    'code-intelligence',
    'test-intelligence',
    'change-intelligence',
  ],
};

async function getConfig(rootDir) {
  const configPath = join(rootDir, '.paaw', 'auto-dispatch', 'config.json');
  if (!existsSync(configPath)) return DEFAULT_CONFIG;
  try {
    const raw = await readFile(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(rootDir, config) {
  const dir = join(rootDir, '.paaw', 'auto-dispatch');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const configPath = join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

export default async function autoDispatchConfigRoutes(req, res) {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const rootDir = urlObj.searchParams.get('path') || process.env.PAAW_ROOT || process.cwd();

  // GET /api/coding-auto-dispatch/config
  if (req.method === 'GET' && urlObj.pathname === '/api/coding-auto-dispatch/config') {
    try {
      const config = await getConfig(rootDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...config, _phases: PROJECT_PHASES }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  // POST /api/coding-auto-dispatch/config
  if (req.method === 'POST' && urlObj.pathname === '/api/coding-auto-dispatch/config') {
    try {
      const { readBody } = await import('./shared.mjs');
      const body = JSON.parse(await readBody(req) || '{}');

      // Merge with existing config
      const existing = await getConfig(rootDir);
      const merged = {
        mode: body.mode || existing.mode || 'em',
        projectPhase: body.projectPhase || existing.projectPhase || 'bootstrap',
        schedule: { ...existing.schedule, ...(body.schedule || {}) },
        model: { ...existing.model, ...(body.model || {}) },
        tasks: body.tasks || existing.tasks,
      };

      await saveConfig(rootDir, merged);

      // ── Sync project.loopMode from projectPhase ──
      const PHASE_TO_LOOP_MODE = { bootstrap: "mini", mvp: "mini", growth: "mini", stable: "full", refactor: "full" };
      const newLoopMode = PHASE_TO_LOOP_MODE[merged.projectPhase] || "mini";
      try {
        const tasksFile = join(rootDir, ".paaw", "tasks", "TASKS.json");
        const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
        const { dirname } = await import('node:path');
        let tasksData = { tasks: [], updatedAt: new Date().toISOString() };
        if (existsSync(tasksFile)) tasksData = JSON.parse(readFileSync(tasksFile, "utf-8"));
        const oldLoopMode = tasksData.loopMode || "mini";
        if (oldLoopMode !== newLoopMode) {
          tasksData.loopMode = newLoopMode;
          if (!existsSync(dirname(tasksFile))) mkdirSync(dirname(tasksFile), { recursive: true });
          writeFileSync(tasksFile, JSON.stringify(tasksData, null, 2), "utf-8");
        }
      } catch (e) { console.error("sync loopMode error:", e.message); }

      // If schedule enabled, register/update PAAW cron job
      if (merged.schedule.enabled && merged.schedule.time) {
        try {
          const [hour, minute] = merged.schedule.time.split(':');
          const expr = `${minute || '0'} ${hour || '22'} * * *`;
          const cronJobId = `auto-dispatch-${Buffer.from(rootDir || '').toString('hex').slice(-20)}`;

          // Check if cron job already exists
          const listResp = await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs`);
          const existingJobs = listResp.ok ? await listResp.json() : [];
          // Also clean up old-style duplicate IDs
          const allNightJobs = existingJobs.filter(j => j.id.startsWith('auto-dispatch-'));
          const existing = allNightJobs.find(j => j.params?.projectPath === rootDir);
          for (const j of allNightJobs) {
            if (j !== existing && j.params?.projectPath === rootDir) {
              await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs/${j.id}`, { method: 'DELETE' });
            }
          }

          const cronPayload = {
            name: `Auto Dispatch (${merged.projectPhase || 'bootstrap'})`,
            type: 'auto-dispatch',
            schedule: expr,
            prompt: '',
            params: { projectPath: rootDir, projectPhase: merged.projectPhase, mode: merged.mode },
            outputTarget: 'chat',
            chatId: '',
          };

          if (existing) {
            // Update existing
            await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs/${cronJobId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...cronPayload, enabled: true }),
            });
            console.log(`[AutoDispatch] Updated cron job: ${cronJobId} schedule=${expr}`);
          } else {
            // Create new
            await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: cronJobId, ...cronPayload }),
            });
            console.log(`[AutoDispatch] Created cron job: ${cronJobId} schedule=${expr}`);
          }
        } catch (err) {
          console.error(`[AutoDispatch] Failed to register cron job:`, err.message);
        }
      } else {
        // Schedule disabled — disable the cron job if it exists
        try {
          const cronJobId = `auto-dispatch-${Buffer.from(rootDir || '').toString('hex').slice(-20)}`;
          const listResp = await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs`);
          const existingJobs = listResp.ok ? await listResp.json() : [];
          // Also clean up old-style duplicate IDs
          const allNightJobs = existingJobs.filter(j => j.id.startsWith('auto-dispatch-'));
          const existing = allNightJobs.find(j => j.params?.projectPath === rootDir);
          for (const j of allNightJobs) {
            if (j !== existing && j.params?.projectPath === rootDir) {
              await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs/${j.id}`, { method: 'DELETE' });
            }
          }
          if (existing && existing.enabled) {
            await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs/${cronJobId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: false }),
            });
            console.log(`[AutoDispatch] Disabled cron job: ${cronJobId}`);
          }
        } catch {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, config: merged }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  return false;
}
