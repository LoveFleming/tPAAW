/**
 * Unit tests — TASK-168 hardening fixes in ExamVault & LearningSpace (TASK-051 tester phase)
 *
 * Targets (read-only, NOT imported):
 *   installed-apps/learning/ui/components/ExamVault.tsx   (commit 2219de72, range f706723..2219de7)
 *   installed-apps/learning/ui/pages/LearningSpace.tsx
 *   packages/ui/src/i18n/locales/{zh-mix,en,zh,ja}.json   (TASK-168 added 8 exam-vault.* keys)
 *
 * Why two layers (same precedent as TASK-105 usage-report-panel / ADR-022 template tests):
 *   1. Both components are React + TSX; the vitest workspace runs in a *node* environment
 *      (no jsdom / @testing-library — see vitest.config.ts), so they cannot be
 *      rendered/imported here, and TASK-051 forbids touching the implementation.
 *   2. Sandbox constraint: no new dependencies may be installed (npm install denied),
 *      so everything below uses only vitest built-ins (vi fake timers, spies).
 *
 * LAYER A — Static contract scan: read the real source text and pin the TASK-168
 *           fixes (M1 api() timeout, M2 keyboard a11y, M3 Escape/focus, M4 atomic
 *           archive + save surfacing). If a future edit regresses a fix, these fail.
 * LAYER B — Executable semantic reproduction: faithful mirrors of the fixed logic
 *           (api() wrapper, apiErrText, Escape predicate, 3-step archive, debounced
 *           save, tree keydown) driven by mock fetch / fake events / fake timers,
 *           proving the behavioral contract on happy path + failure + IME edge cases.
 *
 * TASK-168 fix inventory under test (from QA review qr-20261017-162804-uvyl):
 *   M1 — api() 30s default timeout via AbortController; AbortError → API_TIMEOUT_ERROR;
 *        upload/backup relaxed to 120s; busy always released; localized timeout msg.
 *   M2 — curriculum tree: role=button + tabIndex + aria-expanded + Enter/Space with
 *        IME isComposing guard + focus-visible ring.
 *   M3 — wrongImg modal & teacherChat panel: Escape to close (IME-safe), focus
 *        capture/restore on modal open/close, listener cleanup.
 *   M4 — conversation save: res.ok check + console.warn (no silent swallow);
 *        archive = atomic 3-step (POST → DELETE → only then clear UI).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const EV_PATH = join(ROOT, "installed-apps/learning/ui/components/ExamVault.tsx");
const LS_PATH = join(ROOT, "installed-apps/learning/ui/pages/LearningSpace.tsx");
const LOCALE_DIR = join(ROOT, "packages/ui/src/i18n/locales");

const evSrc = readFileSync(EV_PATH, "utf8");
const lsSrc = readFileSync(LS_PATH, "utf8");
const count = (s, needle) => s.split(needle).length - 1;

// ══════════════════════════════════════════════════════════════════════════
// LAYER A — Static contract scan (pins the REAL shipping source)
// ══════════════════════════════════════════════════════════════════════════

describe("A1 · M1 api() timeout contract (ExamVault source)", () => {
  it("declares API_TIMEOUT_ERROR constant and 30s default timeoutMs", () => {
    expect(evSrc).toContain('const API_TIMEOUT_ERROR = "API_TIMEOUT";');
    expect(evSrc).toContain("timeoutMs = 30000");
  });

  it("uses AbortController: schedules abort, and clears the timer in finally", () => {
    expect(evSrc).toContain("const ctrl = new AbortController();");
    expect(evSrc).toContain("setTimeout(() => ctrl.abort(), timeoutMs)");
    expect(evSrc).toContain("} finally {");
    expect(evSrc).toContain("clearTimeout(timer);");
  });

  it("maps AbortError to API_TIMEOUT_ERROR and non-ok to server error / HTTP status", () => {
    expect(evSrc).toContain('if (e?.name === "AbortError") throw new Error(API_TIMEOUT_ERROR);');
    expect(evSrc).toContain("throw new Error(d.error || `HTTP ${r.status}`)");
  });

  it("relaxes exactly the two long server ops (upload, backup) to 120s", () => {
    expect(count(evSrc, "120000")).toBe(2);
    expect(evSrc).toContain('api("/api/exam-vault/upload", {');
    expect(evSrc).toContain('api("/api/exam-vault/backup", { method: "POST" }, 120000)');
  });

  it("localizes the timeout message via i18n key exam-vault.error.timeout", () => {
    expect(evSrc).toContain(
      'e instanceof Error && e.message === API_TIMEOUT_ERROR ? t("exam-vault.error.timeout")'
    );
  });

  it("releases busy on every path: guard early-return exists and false-count ≥ true-count", () => {
    // The empty-inbox guard must release busy before returning (buttons not stuck disabled)
    expect(evSrc).toContain('setErr(t("exam-vault.empty.noPages")); setBusy(false); return;');
    const trues = count(evSrc, "setBusy(true)");
    const falses = count(evSrc, "setBusy(false)");
    expect(trues).toBeGreaterThan(0);
    expect(falses).toBeGreaterThanOrEqual(trues);
  });
});

describe("A2 · M3 Escape / focus contract (ExamVault source)", () => {
  it("has exactly 2 IME-safe Escape handlers (wrongImg modal + teacherChat panel)", () => {
    expect(count(evSrc, 'e.key === "Escape" && !e.nativeEvent.isComposing')).toBe(2);
  });

  it("captures the trigger element on modal open (document.activeElement) for focus restore", () => {
    expect(evSrc).toContain("wrongImgTriggerRef.current = document.activeElement as HTMLElement | null;");
  });

  it("restores focus on all 3 close paths (overlay click, close button, Escape)", () => {
    expect(count(evSrc, "wrongImgTriggerRef.current?.focus?.()")).toBe(3);
  });

  it("removes the keydown listeners on unmount/state change (both effects)", () => {
    expect(count(evSrc, "return () => window.removeEventListener(\"keydown\", onKey);")).toBe(2);
  });

  it("wrongImg modal is a real dialog (role=dialog + aria-modal) rendered only when open", () => {
    expect(evSrc).toContain('role="dialog" aria-modal="true"');
    expect(evSrc).toContain("{wrongImg && (");
    expect(evSrc).toContain("{teacherChat && (");
  });
});

describe("A3 · M4 save & archive contract (LearningSpace source)", () => {
  it("debounced save no longer swallows failures: res.ok check + console.warn", () => {
    expect(lsSrc).toContain('if (!res.ok) console.warn("[LearningSpace] conversation save failed:"');
    expect(lsSrc).toContain('console.warn("[LearningSpace] conversation save error:"');
  });

  it("archive is a guarded 3-step sequence: both res.ok checks precede any UI clear", () => {
    expect(lsSrc).toContain("if (!postRes.ok) { console.warn(");
    expect(lsSrc).toContain("if (!delRes.ok) { console.warn(");
    const guardDel = lsSrc.indexOf("if (!delRes.ok)");
    const uiClear = lsSrc.indexOf("setCrewConversations(prev => ({ ...prev, [activeCrew]: [] }))");
    expect(guardDel).toBeGreaterThan(-1);
    expect(uiClear).toBeGreaterThan(guardDel); // UI cleared ONLY after DELETE confirmed ok
  });
});

describe("A4 · M2 keyboard a11y contract (LearningSpace source)", () => {
  it("all 3 tree levels are reachable via keyboard: role=button + tabIndex", () => {
    expect(count(lsSrc, 'role="button" tabIndex={0}')).toBe(3);
  });

  it("subject & unit nodes expose expanded state via aria-expanded", () => {
    expect(lsSrc).toContain("aria-expanded={expandedSubjects.has(s.key)}");
    expect(lsSrc).toContain("aria-expanded={expandedUnits.has(u.id)}");
    expect(count(lsSrc, "aria-expanded")).toBeGreaterThanOrEqual(2);
  });

  it("Enter/Space activation guarded by IME isComposing on every tree level", () => {
    expect(lsSrc).toContain('e.key === "Enter" && !e.nativeEvent.isComposing');
    expect(lsSrc).toContain('e.key === " " && !e.nativeEvent.isComposing');
    expect(lsSrc).toContain('(e.key === "Enter" || e.key === " ") && !e.nativeEvent.isComposing');
  });

  it("keyboard focus is visible: focus-visible ring classes present", () => {
    expect(count(lsSrc, "focus-visible:ring")).toBeGreaterThanOrEqual(3);
  });
});

describe("A5 · i18n contract — ExamVault ↔ 4 locale dictionaries", () => {
  const locales = ["zh-mix", "en", "zh", "ja"];
  const load = (l) => JSON.parse(readFileSync(join(LOCALE_DIR, `${l}.json`), "utf8"));

  // Dynamically extract every exam-vault key the component references
  const referenced = [...new Set([...evSrc.matchAll(/t\("(exam-vault\.[a-zA-Z0-9.]+)"/g)].map((m) => m[1]))];

  it("component references a non-trivial set of exam-vault keys (extraction sanity)", () => {
    expect(referenced.length).toBeGreaterThanOrEqual(60);
  });

  it("every referenced key exists with a non-empty value in ALL 4 locales", () => {
    for (const l of locales) {
      const dict = load(l);
      const missing = referenced.filter((k) => !dict[k] || !String(dict[k]).trim());
      expect(missing, `${l} missing: ${missing.join(",")}`).toEqual([]);
    }
  });

  it("the 8 TASK-168 newly added keys exist in ALL 4 locales (regression pin)", () => {
    const newKeys = [
      "exam-vault.action.reparse",
      "exam-vault.action.delete",
      "exam-vault.action.prevPage",
      "exam-vault.action.nextPage",
      "exam-vault.action.close",
      "exam-vault.action.removePage",
      "exam-vault.action.refreshWrong",
      "exam-vault.error.timeout",
    ];
    for (const l of locales) {
      const dict = load(l);
      for (const k of newKeys) {
        expect(dict[k], `${l}.${k}`).toBeTruthy();
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LAYER B — Executable semantic reproduction (behavioral proof)
// ══════════════════════════════════════════════════════════════════════════

// Faithful mirror of ExamVault's api() wrapper (commit 2219de72) — fetch injected for testability
const API_TIMEOUT_ERROR = "API_TIMEOUT";
async function apiMirror(path, init = {}, timeoutMs = 30000, fetchImpl = globalThis.fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await fetchImpl(path, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(API_TIMEOUT_ERROR);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

describe("B1 · api() timeout behavior (mirror of M1)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("resolves and returns parsed JSON on ok; leaves no pending timer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ subjects: ["math"] }),
    });
    const d = await apiMirror("/api/exam-vault/subjects", {}, 30000, fetchImpl);
    expect(d).toEqual({ subjects: ["math"] });
    expect(vi.getTimerCount()).toBe(0); // clearTimeout ran in finally
  });

  it("propagates init (method/headers/body) and injects an AbortSignal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await apiMirror("/api/exam-vault/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, 30000, fetchImpl);
    const [calledPath, calledInit] = fetchImpl.mock.calls[0];
    expect(calledPath).toBe("/api/exam-vault/upload");
    expect(calledInit.method).toBe("POST");
    expect(calledInit.headers).toEqual({ "Content-Type": "application/json" });
    expect(calledInit.body).toBe("{}");
    expect(calledInit.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws the server-provided error message on non-ok with JSON error body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: "卷面必填" }) });
    await expect(apiMirror("/x", {}, 30000, fetchImpl)).rejects.toThrow("卷面必填");
  });

  it("falls back to `HTTP <status>` when the error body is unparseable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error("bad json"); } });
    await expect(apiMirror("/x", {}, 30000, fetchImpl)).rejects.toThrow("HTTP 502");
  });

  // Realistic hang double: an in-flight request that never responds on its own,
  // but — like the real fetch — rejects with AbortError when the signal fires.
  const makeHangFetch = () => vi.fn((_path, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    });
  }));

  it("hang server → aborts at default 30s and throws API_TIMEOUT_ERROR (not a stuck busy)", async () => {
    const hangFetch = makeHangFetch();
    const p = apiMirror("/api/exam-vault/exams", {}, 30000, hangFetch);
    const assertion = expect(p).rejects.toThrow(API_TIMEOUT_ERROR);
    await vi.advanceTimersByTimeAsync(29999);
    expect(hangFetch).toHaveBeenCalledTimes(1); // still pending just before deadline
    expect(hangFetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); // 30s reached → ctrl.abort()
    expect(hangFetch.mock.calls[0][1].signal.aborted).toBe(true);
    await assertion; // AbortError remapped to API_TIMEOUT_ERROR
  });

  it("honors a custom timeoutMs: a 120s op is NOT killed at 30s, only at 120s", async () => {
    const hangFetch = makeHangFetch();
    const p = apiMirror("/api/exam-vault/backup", { method: "POST" }, 120000, hangFetch);
    const assertion = expect(p).rejects.toThrow(API_TIMEOUT_ERROR);
    await vi.advanceTimersByTimeAsync(30000);
    expect(hangFetch.mock.calls[0][1].signal.aborted).toBe(false); // default deadline passed — still alive (relaxed budget)
    await vi.advanceTimersByTimeAsync(90000); // 120s total → abort now
    expect(hangFetch.mock.calls[0][1].signal.aborted).toBe(true);
    await assertion;
  });

  it("a non-abort network error passes through unchanged (not remapped)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiMirror("/x", {}, 30000, fetchImpl)).rejects.toThrow("Failed to fetch");
  });
});

describe("B2 · apiErrText localization mapping (mirror of M1)", () => {
  const t = (k) => ({ "exam-vault.error.timeout": "請求逾時，請稍後再試" }[k] ?? k);
  const apiErrText = (e) =>
    e instanceof Error && e.message === API_TIMEOUT_ERROR
      ? t("exam-vault.error.timeout")
      : String(e?.message || e);

  it("timeout error → localized timeout message", () => {
    expect(apiErrText(new Error(API_TIMEOUT_ERROR))).toBe("請求逾時，請稍後再試");
  });
  it("ordinary server error → its raw message", () => {
    expect(apiErrText(new Error("HTTP 502"))).toBe("HTTP 502");
  });
  it("non-Error value → stringified", () => {
    expect(apiErrText("boom")).toBe("boom");
    expect(apiErrText(undefined)).toBe("undefined");
  });
});

describe("B3 · Escape predicate semantics (mirror of M3)", () => {
  // Mirror of the wrongImg keydown handler contract
  const makeOnKey = ({ close, restoreFocus }) => (e) => {
    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
      close();
      restoreFocus();
    }
  };

  it("Escape (not composing) closes the modal AND restores focus to the trigger", () => {
    const close = vi.fn(); const restoreFocus = vi.fn();
    makeOnKey({ close, restoreFocus })({ key: "Escape", nativeEvent: { isComposing: false } });
    expect(close).toHaveBeenCalledTimes(1);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("Escape DURING IME composition does nothing (no accidental close while typing 中文)", () => {
    const close = vi.fn(); const restoreFocus = vi.fn();
    makeOnKey({ close, restoreFocus })({ key: "Escape", nativeEvent: { isComposing: true } });
    expect(close).not.toHaveBeenCalled();
    expect(restoreFocus).not.toHaveBeenCalled();
  });

  it("non-Escape keys do nothing", () => {
    const close = vi.fn(); const restoreFocus = vi.fn();
    for (const key of ["Enter", " ", "a", "Tab"]) {
      makeOnKey({ close, restoreFocus })({ key, nativeEvent: { isComposing: false } });
    }
    expect(close).not.toHaveBeenCalled();
  });

  it("effect cleanup removes the listener exactly once (unmount/close stops listening)", () => {
    // Mirror: useEffect(() => { window.addEventListener(k, onKey); return () => removeEventListener(k, onKey); }, [wrongImg])
    const window_ = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const onKey = () => {};
    window_.addEventListener("keydown", onKey);
    const cleanup = () => window_.removeEventListener("keydown", onKey);
    cleanup();
    expect(window_.removeEventListener).toHaveBeenCalledWith("keydown", onKey);
    expect(window_.removeEventListener).toHaveBeenCalledTimes(1);
  });
});

describe("B4 · atomic 3-step archive (mirror of M4) — UI clears only after server state confirmed", () => {
  // Faithful mirror of the TASK-168 archive sequence
  async function archiveMirror(fetchImpl, { activeCrew, rootPath, messages }) {
    const out = { postCalled: 0, deleteCalled: 0, uiCleared: false };
    try {
      const postRes = await fetchImpl(
        `/api/conversations/${encodeURIComponent(activeCrew)}?root=${encodeURIComponent(rootPath)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: `archive-${Date.now()}`, messages }) }
      );
      out.postCalled++;
      if (!postRes.ok) return out; // abort — UI untouched
      const delRes = await fetchImpl(
        `/api/conversations/${encodeURIComponent(activeCrew)}/active?root=${encodeURIComponent(rootPath)}`,
        { method: "DELETE" }
      );
      out.deleteCalled++;
      if (!delRes.ok) return out; // abort — UI untouched (the pre-fix divergence point)
      out.uiCleared = true; // only after both confirmed
      return out;
    } catch { return out; }
  }

  const base = { activeCrew: "math_teacher", rootPath: "/w", messages: [{ role: "user", content: "hi" }] };

  it("all steps ok → archive saved, active deleted, UI cleared", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const out = await archiveMirror(fetchImpl, base);
    expect(out).toMatchObject({ postCalled: 1, deleteCalled: 1, uiCleared: true });
  });

  it("POST fails → sequence aborts BEFORE delete; UI untouched", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 });
    const out = await archiveMirror(fetchImpl, base);
    expect(out.postCalled).toBe(1);
    expect(out.deleteCalled).toBe(0);
    expect(out.uiCleared).toBe(false);
  });

  it("POST ok but DELETE fails → UI still untouched (regression pin: pre-fix code cleared UI here)", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    const out = await archiveMirror(fetchImpl, base);
    expect(out.deleteCalled).toBe(1);
    expect(out.uiCleared).toBe(false); // THE fix: no state divergence between UI and server
  });

  it("network error mid-sequence → caught; UI untouched, no unhandled rejection", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const out = await archiveMirror(fetchImpl, base);
    expect(out.uiCleared).toBe(false);
  });
});

describe("B5 · debounced conversation save failure surfacing (mirror of M4)", () => {
  it("non-ok save → console.warn carries the status; does not throw into the debounce", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = { ok: false, status: 503 };
    // Mirror of the fixed effect body
    const effectBody = async () => {
      try {
        if (!res.ok) console.warn("[LearningSpace] conversation save failed:", res.status, "crew");
      } catch (e) { console.warn("[LearningSpace] conversation save error:", e); }
    };
    await expect(effectBody()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[LearningSpace] conversation save failed:", 503, "crew");
  });
});

describe("B6 · curriculum tree keydown activation (mirror of M2)", () => {
  // Mirror of the subject/unit node handler (combined variant for concept nodes)
  const makeHandler = (activate) => (e) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) activate();
    else if (e.key === " " && !e.nativeEvent.isComposing) { e.preventDefault(); activate(); }
  };

  it("Enter (not composing) activates the node", () => {
    const activate = vi.fn();
    makeHandler(activate)({ key: "Enter", nativeEvent: { isComposing: false } });
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("Space (not composing) activates AND preventDefaults (no page scroll)", () => {
    const activate = vi.fn(); const preventDefault = vi.fn();
    makeHandler(activate)({ key: " ", nativeEvent: { isComposing: false }, preventDefault });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("IME composition swallows Enter/Space (typing 注音/日文 must not open nodes)", () => {
    const activate = vi.fn(); const preventDefault = vi.fn();
    makeHandler(activate)({ key: "Enter", nativeEvent: { isComposing: true }, preventDefault });
    makeHandler(activate)({ key: " ", nativeEvent: { isComposing: true }, preventDefault });
    expect(activate).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
