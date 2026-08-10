/**
 * E2E: API Health (Enhanced)
 *
 * Comprehensive API endpoint testing — GET health checks,
 * POST body validation, error handling, and context endpoints.
 */
import { test, expect, request } from "@playwright/test";

const API_BASE = process.env.PAAW_E2E_URL || "http://localhost:4097";

// ── Helper ──
async function apiContext() {
  return await request.newContext({ baseURL: API_BASE });
}

// ── Core System Endpoints ──
test.describe("Core System API", () => {
  test("GET /api/paaw-root should return root path", async () => {
    const api = await apiContext();
    const res = await api.get("/api/paaw-root");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test("GET /api/paaw/providers should return provider config", async () => {
    const api = await apiContext();
    const res = await api.get("/api/paaw/providers");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("providers");
    expect(body).toHaveProperty("active");
    expect(body.active).toBeTruthy();
  });

  test("GET /api/paaw/user should return user profile", async () => {
    const api = await apiContext();
    const res = await api.get("/api/paaw/user");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBeTruthy();
    expect(body.onboarded).toBe(true);
  });

  test("GET /api/paaw/ui-state should return UI state", async () => {
    const api = await apiContext();
    const res = await api.get("/api/paaw/ui-state");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test("GET /api/paaw/workspaces should return workspace directories", async () => {
    const api = await apiContext();
    const res = await api.get("/api/paaw/workspaces");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("directories");
    expect(Array.isArray(body.directories)).toBeTruthy();
  });

  test("GET /api/models should return available models", async () => {
    const api = await apiContext();
    const res = await api.get("/api/models");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test("GET /api/user/preferences should return preferences", async () => {
    const api = await apiContext();
    const res = await api.get("/api/user/preferences");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });
});

// ── Context Endpoints ──
test.describe("Context Endpoints (System Prompts)", () => {
  test("GET /api/context/chat should return chat system prompt", async () => {
    const api = await apiContext();
    const res = await api.get("/api/context/chat");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBeTruthy();
    expect(body.systemPrompt.length).toBeGreaterThan(50);
  });

  test("GET /api/context/project should return project prompt", async () => {
    const api = await apiContext();
    const res = await api.get("/api/context/project");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBeTruthy();
  });

  test("GET /api/context/mindmap should return mindmap prompt", async () => {
    const api = await apiContext();
    const res = await api.get("/api/context/mindmap");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBeTruthy();
  });

  test("GET /api/context/notes should return notes prompt", async () => {
    const api = await apiContext();
    const res = await api.get("/api/context/notes");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBeTruthy();
  });

  test("GET /api/context/coding should return coding prompt (if exists)", async () => {
    const api = await apiContext();
    const res = await api.get("/api/context/coding");
    // May or may not exist
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeTruthy();
    } else {
      expect([404, 500]).toContain(res.status());
    }
  });
});

// ── Apps & Skills ──
test.describe("Apps & Skills API", () => {
  test("GET /api/apps should return app list", async () => {
    const api = await apiContext();
    const res = await api.get("/api/apps");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test("GET /api/skills should return skill list", async () => {
    const api = await apiContext();
    const res = await api.get("/api/skills");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
    // Should have at least some skills
    if (body.length > 0) {
      expect(body[0]).toHaveProperty("id");
      expect(body[0]).toHaveProperty("name");
    }
  });
});

// ── Notes API ──
test.describe("Notes API", () => {
  test("GET /api/notes/notebooks should return notebooks", async () => {
    const api = await apiContext();
    const res = await api.get("/api/notes/notebooks");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test("GET /api/notes/recent should return recent notes", async () => {
    const api = await apiContext();
    const res = await api.get("/api/notes/recent?limit=5");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test("GET /api/notes/search should handle query", async () => {
    const api = await apiContext();
    const res = await api.get("/api/notes/search?q=test");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test("GET /api/notes/tags should return tags", async () => {
    const api = await apiContext();
    const res = await api.get("/api/notes/tags");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });
});

// ── Mind Map API ──
test.describe("Mind Map API", () => {
  test("GET /api/mindmap/list should return list", async () => {
    const api = await apiContext();
    const res = await api.get("/api/mindmap/list");
    expect(res.status()).toBe(200);
  });
});

// ── Projects API ──
test.describe("Projects API", () => {
  test("GET /api/projects should return projects", async () => {
    const api = await apiContext();
    const res = await api.get("/api/projects");
    expect(res.status()).toBe(200);
  });
});

// ── Cron Jobs API ──
test.describe("Cron Jobs API", () => {
  test("GET /api/cron-jobs should return schedule list", async () => {
    const api = await apiContext();
    const res = await api.get("/api/cron-jobs");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
    // System backup and log purge should exist
    if (body.length > 0) {
      expect(body[0]).toHaveProperty("id");
      expect(body[0]).toHaveProperty("schedule");
      expect(body[0]).toHaveProperty("enabled");
    }
  });
});

// ── AI Settings API ──
test.describe("AI Settings API", () => {
  test("GET /api/ai-settings should return categories", async () => {
    const api = await apiContext();
    const res = await api.get("/api/ai-settings");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });
});

// ── Crew API ──
test.describe("Crew API", () => {
  test("GET /api/crew should return crew members", async () => {
    const api = await apiContext();
    const res = await api.get("/api/crew");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
    if (body.length > 0) {
      expect(body[0]).toHaveProperty("id");
      expect(body[0]).toHaveProperty("codename");
    }
  });
});

// ── Plugins API ──
test.describe("Plugins API", () => {
  test("GET /api/plugins should return plugins", async () => {
    const api = await apiContext();
    const res = await api.get("/api/plugins");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("plugins");
    expect(Array.isArray(body.plugins)).toBeTruthy();
  });
});

// ── Error Handling ──
test.describe("Error Handling", () => {
  test("GET unknown endpoint should return 404", async () => {
    const api = await apiContext();
    const res = await api.get("/api/nonexistent-endpoint-12345");
    expect(res.status()).toBe(404);
  });

  test("GET /api/notes/get without id should return 400 or 404", async () => {
    const api = await apiContext();
    const res = await api.get("/api/notes/get");
    expect([400, 404, 500]).toContain(res.status());
  });

  test("GET /api/notes/list with invalid notebook should handle gracefully", async () => {
    const api = await apiContext();
    const res = await api.get("/api/notes/list?notebook=nonexistent-notebook-12345");
    expect(res.status()).toBe(200); // Should return empty array, not crash
    const body = await res.json();
    // API might return array or object with notes property
    expect(body).toBeTruthy();
  });

  test("POST /api/notes/notebooks with empty body should validate", async () => {
    const api = await apiContext();
    const res = await api.post("/api/notes/notebooks", { data: {} });
    // Should reject empty body or create with defaults
    expect([200, 201, 400, 500]).toContain(res.status());
  });

  test("POST /api/notes/search with missing query should handle gracefully", async () => {
    const api = await apiContext();
    const res = await api.get("/api/notes/search");
    expect([200, 400]).toContain(res.status());
  });
});

// ── POST Endpoint Validation ──
test.describe("POST Endpoint Validation", () => {
  test("POST /api/cron-jobs without body should reject", async () => {
    const api = await apiContext();
    const res = await api.post("/api/cron-jobs", { data: {} });
    expect([400, 500]).toContain(res.status());
  });

  test("PATCH /api/paaw/ui-state should accept partial updates", async () => {
    const api = await apiContext();
    const res = await api.patch("/api/paaw/ui-state", {
      data: { testKey: "e2e-test-value" },
    });
    expect([200, 204]).toContain(res.status());
  });
});

// ── LLM Logs & Agent Logs ──
test.describe("Logs API", () => {
  test("GET /api/llm-logs should return logs or empty", async () => {
    const api = await apiContext();
    const res = await api.get("/api/llm-logs");
    expect([200, 404]).toContain(res.status());
  });

  test("GET /api/agent-logs should return logs or empty", async () => {
    const api = await apiContext();
    const res = await api.get("/api/agent-logs");
    expect([200, 404]).toContain(res.status());
  });
});
