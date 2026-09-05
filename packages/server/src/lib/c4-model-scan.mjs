/**
 * c4-model-scan.mjs — C4 Model（對外連線全景）2026-09-05
 *
 * Fleming 需求：release unit 的 C4 model — 主要整理對外服務、DB 等。
 * 做法（error-codes v2 同款）：機器收集證據（零 token）+ LLM 組裝 C4 L1/L2。
 *
 * 安全鐵律：env 只抓 KEY 名不抓值；URI 剝 userinfo（credentials 不入庫）。
 *
 * 產出：{ru}/.paaw/c4-model.json
 *   { system, containers[], externalSystems[], relationships[], notes,
 *     stats: { containers, external, relationships }, scannedAt, method:"llm-v1" }
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join, resolve, relative, extname } from "path";
import { DATA_HOME } from "../data-home.mjs";

// ── 已知外部服務依賴表（不足的自動 heuristic 補） ──
const DEP_RULES = [
  { cat: "db", re: /^(pg|postgres|postgresql|mysql|mysql2|mongoose|mongodb|better-sqlite3|sqlite3|prisma|@prisma\/client|typeorm|sequelize|knex|mariadb|cassandra-driver|neo4j-driver|@elastic\/elasticsearch|elasticsearch)$/ },
  { cat: "cache", re: /^(redis|ioredis|@redis\/client|node-cache|lru-cache)$/ },
  { cat: "queue", re: /^(amqplib|amqp|rabbitmq|kafkajs|kafka-node|nats|@nestjs\/microservices|bullmq|bull|bee-queue|sqs-consumer|celery|kombu)$/ },
  { cat: "cloud", re: /^(aws-sdk|@aws-sdk\/.*|googleapis|@google-cloud\/.*|firebase-admin|azure-storage|@azure\/.*|aliyun|oss|cos-nodejs-sdk-v5)$/ },
  { cat: "api-client", re: /^(stripe|twilio|sendgrid|@sendgrid\/mail|nodemailer|mailer|openai|@anthropic-ai\/sdk|anthropic|@google\/generative-ai|@slack\/.*|line-bot-sdk|graphql-request|got|axios|cross-fetch)$/ },
  { cat: "framework", re: /^(express|koa|fastify|hono|@nestjs\/core|next|nuxt|remix|@remix-run\/.*|sveltekit|astro|@sveltejs\/kit|socket\.io|ws|graphql|apollo-server|@apollo\/server|django|flask|fastapi|tornado|sanic|gin-gonic|echo|fiber)$/ },
];
const HEURISTIC = /(redis|mongo|mysql|postgres|mariadb|kafka|rabbit|amqp|elastic|opensearch|nats|etcd|consul|vault|smtp|mailer|sendgrid|ses|s3|storage|queue|broker|gateway|openai|anthropic|gemini|llm)/i;

// Python / Go / Java 對應表（名稱比對用同一套 DEP_RULES + HEURISTIC）
const PY_EXTRA = /^(sqlalchemy|psycopg2|psycopg|asyncpg|aiomysql|pymongo|motor|redis|celery|kafka-python|confluent-kafka|pika|boto3|botocore|openai|anthropic|google-genai|django|flask|fastapi|uvicorn|gunicorn)$/;

const ENV_KEY_RE = /^(DATABASE|DB|REDIS|RABBIT|MQ|KAFKA|MONGO|MYSQL|POSTGRES|PG|MARIADB|ELASTIC|ES|OPENSEARCH|QUEUE|CACHE|SMTP|MAIL|SES|SNS|SQS|S3|OSS|COS|MINIO|VAULT|CONSUL|ETCD|NATS)(_|$)|(_|^)(API_KEY|TOKEN|SECRET|ENDPOINT|URL|HOST|PORT|DSN|CONNECTION|URI)(_|$)/i;

const URI_RE = /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|kafka|nats|grpc|ftp):\/\/[^\s"'`]+|\bhttps?:\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}[^\s"'`>]*/gi;

const MAX_URI_PER_FILE = 5;

function _readJson(p) { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; } }

function _classifyDep(name) {
  for (const r of DEP_RULES) if (r.re.test(name)) return r.cat;
  if (HEURISTIC.test(name)) return "external?";
  return null; // 一般 lib 不感興趣
}

/** 收集外部連線證據（純 deterministic、零 token） */
export function collectExternalSignals(root) {
  const projectRoot = resolve(root);
  const deps = [];
  const envKeys = [];
  const compose = [];
  const exposedPorts = [];
  const uris = [];

  // ── manifests：package.json（root + 一層 workspace）──
  const manifests = [join(projectRoot, "package.json")];
  for (const ws of ["packages", "apps", "services", "sites"]) {
    const d = join(projectRoot, ws);
    if (existsSync(d)) {
      try {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory() && existsSync(join(d, e.name, "package.json"))) manifests.push(join(d, e.name, "package.json"));
        }
      } catch {}
    }
  }
  for (const mp of manifests) {
    const pkg = _readJson(mp);
    if (!pkg?.name && !pkg?.dependencies) continue;
    const rel = relative(projectRoot, mp).replace(/\\/g, "/");
    for (const sec of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, ver] of Object.entries(pkg[sec] || {})) {
        const cat = _classifyDep(name);
        if (cat) deps.push({ name, version: String(ver).slice(0, 30), cat, source: rel, manager: "npm" });
      }
    }
  }

  // ── Python / Go / Java manifests ──
  const req = join(projectRoot, "requirements.txt");
  if (existsSync(req)) {
    const rel = relative(projectRoot, req).replace(/\\/g, "/");
    for (const line of readFileSync(req, "utf-8").split("\n")) {
      const m = line.trim().match(/^([A-Za-z0-9_.-]+)\s*[=><~]/);
      if (!m) continue;
      const cat = PY_EXTRA.test(m[1]) ? _classifyDep(m[1].toLowerCase()) || "external?" : _classifyDep(m[1]);
      if (cat) deps.push({ name: m[1], version: "", cat, source: rel, manager: "pip" });
    }
  }
  const pyproj = join(projectRoot, "pyproject.toml");
  if (existsSync(pyproj)) {
    const rel = relative(projectRoot, pyproj).replace(/\\/g, "/");
    for (const m of readFileSync(pyproj, "utf-8").matchAll(/^\s*([A-Za-z0-9_.-]+)\s*[=<>~]/gm)) {
      const cat = PY_EXTRA.test(m[1]) ? _classifyDep(m[1].toLowerCase()) || "external?" : _classifyDep(m[1]);
      if (cat) deps.push({ name: m[1], version: "", cat, source: rel, manager: "pip" });
    }
  }
  const gomod = join(projectRoot, "go.mod");
  if (existsSync(gomod)) {
    const rel = relative(projectRoot, gomod).replace(/\\/g, "/");
    for (const m of readFileSync(gomod, "utf-8").matchAll(/^\s+([A-Za-z0-9_.\/-]+)\s+v[\d.]+/gm)) {
      const short = m[1].split("/").pop();
      const cat = _classifyDep(short) || (HEURISTIC.test(m[1]) ? "external?" : null);
      if (cat) deps.push({ name: m[1], version: "", cat, source: rel, manager: "go" });
    }
  }
  for (const [mf, mgr] of [["pom.xml", "maven"], ["build.gradle", "gradle"]]) {
    const p = join(projectRoot, mf);
    if (!existsSync(p)) continue;
    const rel = relative(projectRoot, p).replace(/\\/g, "/");
    const txt = readFileSync(p, "utf-8");
    const ids = [...txt.matchAll(/<artifactId>([A-Za-z0-9._-]+)<\/artifactId>/g)].map(x => x[1])
      .concat([...txt.matchAll(/(?:implementation|api|compile|runtimeOnly)[\s'("]+([A-Za-z0-9._:$-]+)/g)].map(x => x[1]));
    for (const id of new Set(ids)) {
      const cat = _classifyDep(id) || (HEURISTIC.test(id) ? "external?" : null);
      if (cat) deps.push({ name: id, version: "", cat, source: rel, manager: mgr });
    }
  }

  // ── env 檔（只抓 KEY 名，值絕不入庫）──
  const envFiles = new Set([".env.example", ".env.sample", ".env.template", ".env.local.example", ".env"]);
  const scanDirForEnv = (dir, depth) => {
    if (depth > 2) return;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".git")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!["node_modules", "dist", "build", ".paaw", "vendor"].includes(e.name)) scanDirForEnv(p, depth + 1); continue; }
      if (!envFiles.has(e.name) && !(e.name.endsWith(".env") && !e.name.startsWith(".env."))) continue;
      const rel = relative(projectRoot, p).replace(/\\/g, "/");
      for (const line of readFileSync(p, "utf-8").split("\n").slice(0, 200)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/);
        if (m && ENV_KEY_RE.test(m[1])) envKeys.push({ key: m[1], file: rel });
      }
    }
  };
  scanDirForEnv(projectRoot, 0);

  // ── docker-compose ──
  for (const cf of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    const p = join(projectRoot, cf);
    if (!existsSync(p)) continue;
    const txt = readFileSync(p, "utf-8");
    let current = null;
    for (const line of txt.split("\n")) {
      const svc = line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
      if (svc && !["version", "services", "volumes", "networks"].includes(svc[1])) {
        if (current) compose.push(current); // 新 service 前先收掉前一個（v1 bug：直接覆蓋丢失 api/db）
        current = { service: svc[1], image: "", ports: [] };
      }
      else if (current && line.match(/^ {4}/)) {
        const img = line.match(/^\s*image:\s*(\S+)/);
        if (img) current.image = img[1];
        const port = line.match(/^\s*-\s*["']?(\d{3,5}):(\d{3,5})/);
        if (port) current.ports.push(port[2]);
      } else if (current) { compose.push(current); current = null; }
    }
    if (current) compose.push(current);
  }

  // ── Dockerfile EXPOSE ──
  for (const df of ["Dockerfile", "Dockerfile.dev"]) {
    const p = join(projectRoot, df);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, "utf-8").matchAll(/^\s*EXPOSE\s+(\d+(?:\/\w+)?)/gm)) {
      exposedPorts.push(String(m[1]).split("/")[0]);
    }
  }

  // ── URI schemes（config + 常見 config 目錄；剝 userinfo）──
  const configDirs = ["config", "src/config", "conf", "settings"];
  const configFiles = new Set(["config.json", "config.yaml", "config.yml", "config.ts", "config.js", "config.mjs", "default.json", "production.json"]);
  const scanUri = (p) => {
    let txt; try { txt = readFileSync(p, "utf-8"); } catch { return; }
    if (txt.length > 500_000) return;
    const rel = relative(projectRoot, p).replace(/\\/g, "/");
    let count = 0;
    const lines = txt.split("\n");
    for (let i = 0; i < lines.length && count < MAX_URI_PER_FILE; i++) {
      for (const m of lines[i].matchAll(URI_RE)) {
        if (count++ >= MAX_URI_PER_FILE) break;
        try {
          const u = new URL(m[0].replace(/[,;)\]]+$/, ""));
          uris.push({ scheme: u.protocol.replace(":", ""), host: u.host, file: rel, line: i + 1 });
        } catch {
          const bare = m[0].replace(/^[a-z+]+:\/\//, "").split("/")[0].split("@").pop();
          if (bare) uris.push({ scheme: m[0].split("://")[0], host: bare.split(":")[0], file: rel, line: i + 1 });
        }
      }
    }
  };
  scanUri(join(projectRoot, ".env.example"));
  for (const d of configDirs) {
    const dp = join(projectRoot, d);
    if (!existsSync(dp)) continue;
    try {
      for (const e of readdirSync(dp, { withFileTypes: true })) {
        if (e.isFile() && configFiles.has(e.name)) scanUri(join(dp, e.name));
      }
    } catch {}
  }
  for (const f of ["docker-compose.yml", "docker-compose.yaml"]) {
    const p = join(projectRoot, f);
    if (existsSync(p)) scanUri(p);
  }

  return {
    projectRoot,
    deps: deps.slice(0, 120),
    envKeys: [...new Map(envKeys.map(x => [x.key + "|" + x.file, x])).values()].slice(0, 80),
    compose,
    exposedPorts: [...new Set(exposedPorts)],
    uris: uris.slice(0, 60),
  };
}

function _loadTemplate(projectRoot) {
  const override = join(projectRoot, ".paaw", "prompts", "code-understanding", "c4-model.md");
  if (existsSync(override)) { try { return readFileSync(override, "utf-8"); } catch {} }
  try { return readFileSync(join(DATA_HOME, "prompts", "code-understanding", "c4-model.md"), "utf-8"); } catch { return ""; }
}

const _str = (v, max = 200) => typeof v === "string" ? v.slice(0, max) : "";
const _evidence = (v) => (Array.isArray(v) ? v.filter(x => typeof x === "string").slice(0, 6).map(x => x.slice(0, 150)) : []);

/**
 * 完整組裝：收集證據 → LLM 組 C4 → normalize → 寫 .paaw/c4-model.json
 * @param callLLM async ({messages, temperature, thinking}) => {content}
 */
export async function organizeC4Model(root, { callLLM, onProgress, timeoutMs = 600_000 } = {}) {
  const material = collectExternalSignals(root);
  const template = _loadTemplate(resolve(root));
  if (!template) throw new Error("prompt template c4-model.md not found");

  const userContent = template
    + `\n\n--- EXTERNAL SIGNALS（機器收集的證據 — env 只含 KEY 名，值不入庫）---\n`
    + JSON.stringify(material);

  onProgress?.(`LLM assembling C4 from ${material.deps.length} deps / ${material.envKeys.length} env keys / ${material.compose.length} compose services...`);
  const res = await callLLM({
    messages: [{ role: "user", content: userContent }],
    temperature: 0,
    thinking: { type: "disabled" },
    timeoutMs,
  });
  let txt = String(res?.content || "").trim();
  if (!txt) throw new Error("empty LLM response");
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) txt = fence[1].trim();
  const parsed = JSON.parse(txt);

  // normalize：長度上限 + 型別清洗；evidence 陣列化
  const containers = (Array.isArray(parsed.containers) ? parsed.containers : []).map(c => ({
    name: _str(c.name, 80) || "?",
    type: _str(c.type, 30),
    technology: _str(c.technology, 120),
    description: _str(c.description, 300),
    evidence: _evidence(c.evidence),
  }));
  const externalSystems = (Array.isArray(parsed.externalSystems) ? parsed.externalSystems : []).map(c => ({
    name: _str(c.name, 80) || "?",
    type: _str(c.type, 30),
    technology: _str(c.technology, 120),
    description: _str(c.description, 300),
    evidence: _evidence(c.evidence),
  }));
  const relationships = (Array.isArray(parsed.relationships) ? parsed.relationships : []).map(r => ({
    from: _str(r.from, 80) || "?",
    to: _str(r.to, 80) || "?",
    protocol: _str(r.protocol, 40),
    description: _str(r.description, 200),
  }));

  const result = {
    scannedAt: new Date().toISOString(),
    method: "llm-v1",
    system: { name: _str(parsed.system?.name, 120), description: _str(parsed.system?.description, 300) },
    containers,
    externalSystems,
    relationships,
    notes: _str(parsed.notes, 500),
    stats: { containers: containers.length, external: externalSystems.length, relationships: relationships.length },
  };
  writeFileSync(join(resolve(root), ".paaw", "c4-model.json"), JSON.stringify(result, null, 2));
  return result;
}
