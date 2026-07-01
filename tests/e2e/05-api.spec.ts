/**
 * E2E: API Health
 *
 * Verifies backend API endpoints respond correctly.
 * These tests don't need the UI — they hit the API directly.
 */
import { test, expect, request } from "@playwright/test";

const API_BASE = process.env.PAAW_E2E_URL || "http://localhost:4097";

test.describe("API Endpoints", () => {
  test("GET /api/paaw-root should return root path", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/paaw-root");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test("GET /api/paaw/providers should return provider config", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/paaw/providers");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("providers");
    expect(body).toHaveProperty("active");
  });

  test("GET /api/user/preferences should return preferences", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/user/preferences");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test("GET /api/context/chat should return system prompt", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/context/chat");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBeTruthy();
    expect(body.systemPrompt.length).toBeGreaterThan(100);
  });

  test("GET /api/context/project should return project prompt", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/context/project");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBeTruthy();
  });

  test("GET /api/context/mindmap should return mindmap prompt", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/context/mindmap");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBeTruthy();
  });

  test("GET /api/context/notes should return notes prompt", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/context/notes");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBeTruthy();
  });

  test("GET /api/apps should return app list", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/apps");
    expect(res.status()).toBe(200);
  });

  test("GET /api/skills should return skill list", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/skills");
    expect(res.status()).toBe(200);
  });

  test("GET /api/mindmap/list should return list", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/mindmap/list");
    expect(res.status()).toBe(200);
  });

  test("GET /api/notes/notebooks should return notebooks", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/notes/notebooks");
    expect(res.status()).toBe(200);
  });

  test("GET /api/projects should return projects", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/projects");
    expect(res.status()).toBe(200);
  });

  test("GET /api/ai-settings should return categories", async () => {
    const api = await request.newContext({ baseURL: API_BASE });
    const res = await api.get("/api/ai-settings");
    expect(res.status()).toBe(200);
  });
});
