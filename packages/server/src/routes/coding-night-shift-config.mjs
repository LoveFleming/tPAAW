/**
 * coding-night-shift-config.mjs — Night Shift 設定 API
 *
 * GET  /api/coding-night-shift/config   — 取得設定
 * POST /api/coding-night-shift/config   — 更新設定
 *
 * 設定存在 .paaw/night-shift/config.json:
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
  const configPath = join(rootDir, '.paaw', 'night-shift', 'config.json');
  if (!existsSync(configPath)) return DEFAULT_CONFIG;
  try {
    const raw = await readFile(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(rootDir, config) {
  const dir = join(rootDir, '.paaw', 'night-shift');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const configPath = join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

export default async function nightShiftConfigRoutes(req, res) {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const rootDir = urlObj.searchParams.get('path') || process.env.PAAW_ROOT || process.cwd();

  // GET /api/coding-night-shift/config
  if (req.method === 'GET' && urlObj.pathname === '/api/coding-night-shift/config') {
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

  // POST /api/coding-night-shift/config
  if (req.method === 'POST' && urlObj.pathname === '/api/coding-night-shift/config') {
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

      // If schedule enabled, register/update PAAW cron job
      if (merged.schedule.enabled && merged.schedule.time) {
        try {
          const [hour, minute] = merged.schedule.time.split(':');
          const expr = `${minute || '0'} ${hour || '22'} * * *`;
          const cronJobId = `night-shift-${(rootDir || '').replace(/[^a-zA-Z0-9]/g, '-').slice(-40)}`;

          // Check if cron job already exists
          const listResp = await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs`);
          const existingJobs = listResp.ok ? await listResp.json() : [];
          const existing = existingJobs.find(j => j.id === cronJobId);

          const cronPayload = {
            name: `Night Shift (${merged.projectPhase || 'bootstrap'})`,
            type: 'report',
            skillId: '',
            schedule: expr,
            prompt: `You are the Night Shift EM. Read the night shift config from .paaw/night-shift/config.json in the project root. Project phase: ${merged.projectPhase || 'bootstrap'}. Mode: ${merged.mode}. Execute the overnight runner by calling: POST http://127.0.0.1:${PORT}/api/coding-night-shift/start?path=${encodeURIComponent(rootDir)} with body {"mode":"${merged.mode}"}. Report the results.`,
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
            console.log(`[NightShift] Updated cron job: ${cronJobId} schedule=${expr}`);
          } else {
            // Create new
            await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: cronJobId, ...cronPayload }),
            });
            console.log(`[NightShift] Created cron job: ${cronJobId} schedule=${expr}`);
          }
        } catch (err) {
          console.error(`[NightShift] Failed to register cron job:`, err.message);
        }
      } else {
        // Schedule disabled — disable the cron job if it exists
        try {
          const cronJobId = `night-shift-${(rootDir || '').replace(/[^a-zA-Z0-9]/g, '-').slice(-40)}`;
          const listResp = await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs`);
          const existingJobs = listResp.ok ? await listResp.json() : [];
          const existing = existingJobs.find(j => j.id === cronJobId);
          if (existing && existing.enabled) {
            await fetch(`http://127.0.0.1:${PORT}/api/cron-jobs/${cronJobId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: false }),
            });
            console.log(`[NightShift] Disabled cron job: ${cronJobId}`);
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
