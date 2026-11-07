// uiFeedback — imperative toast + confirm（2026-10-02 分家前清理）
//
// 取代 alert() / confirm() 的輕量替代品（semgrep javascript-alert/confirm 清零）：
//   uiAlert(msg)            — toast 通知（錯誤訊息可關閉，5s 自動消失）
//   uiAlertError(msg)       — 同上，紅色邊（錯誤情境）
//   uiConfirm(msg): Promise<boolean> — 取代 if (!confirm(x)) return;
//       → if (!(await uiConfirm(x))) return;   （所在函式需為 async）
//
// 實作：直接掛在 document.body 的 imperative DOM — 不需要 React context/provider，
// call site 改動最小。樣式對齊 app 的 stone/圓角/陰影語彙。

let _container: HTMLDivElement | null = null;

function _ensureContainer(): HTMLDivElement {
  if (_container && document.body.contains(_container)) return _container;
  _container = document.createElement("div");
  _container.setAttribute("data-ui-feedback-root", "1");
  Object.assign(_container.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "9999",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    maxWidth: "380px",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(_container);
  return _container;
}

function _dismiss(btn: HTMLButtonElement) {
  const toast = btn.closest("[data-ui-toast]") as HTMLElement | null;
  if (toast) toast.remove();
}

export function uiAlert(message: string, opts: { error?: boolean; timeoutMs?: number } = {}) {
  const root = _ensureContainer();
  const toast = document.createElement("div");
  toast.setAttribute("data-ui-toast", "1");
  Object.assign(toast.style, {
    pointerEvents: "auto",
    background: "#fff",
    border: `1px solid ${opts.error ? "#fca5a5" : "#e7e5e4"}`,
    borderLeft: `4px solid ${opts.error ? "#dc2626" : "#10b981"}`,
    borderRadius: "8px",
    boxShadow: "0 4px 12px rgba(0,0,0,.12)",
    padding: "10px 12px",
    fontSize: "13px",
    lineHeight: "1.5",
    color: "#44403c",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    fontFamily: "inherit",
  } satisfies Partial<CSSStyleDeclaration>);

  const text = document.createElement("div");
  text.style.flex = "1";
  text.textContent = String(message ?? "");
  toast.appendChild(text);

  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "close");
  Object.assign(close.style, {
    border: "none",
    background: "none",
    cursor: "pointer",
    fontSize: "15px",
    color: "#a8a29e",
    padding: "0 2px",
    lineHeight: "1",
  } satisfies Partial<CSSStyleDeclaration>);
  close.onclick = () => _dismiss(close);
  toast.appendChild(close);

  root.appendChild(toast);
  const ms = opts.timeoutMs ?? (opts.error ? 8000 : 5000);
  if (ms > 0) setTimeout(() => toast.remove(), ms);
}

export function uiAlertError(message: string, opts: { timeoutMs?: number } = {}) {
  uiAlert(message, { ...opts, error: true });
}

/** 取代 if (!confirm(x)) return; → if (!(await uiConfirm(x))) return; */
export function uiConfirm(message: string, opts: { title?: string; confirmText?: string; cancelText?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const root = _ensureContainer();
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9998",
      background: "rgba(0,0,0,.25)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "auto",
    } satisfies Partial<CSSStyleDeclaration>);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    Object.assign(dialog.style, {
      background: "#fff",
      border: "1px solid #e7e5e4",
      borderRadius: "10px",
      boxShadow: "0 12px 32px rgba(0,0,0,.18)",
      padding: "18px 20px",
      maxWidth: "400px",
      width: "calc(100vw - 48px)",
      fontFamily: "inherit",
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement("div");
    title.textContent = opts.title || "確認";
    Object.assign(title.style, { fontWeight: "600", fontSize: "14px", color: "#1c1917", marginBottom: "8px" } satisfies Partial<CSSStyleDeclaration>);
    dialog.appendChild(title);

    const body = document.createElement("div");
    body.textContent = String(message ?? "");
    Object.assign(body.style, { fontSize: "13px", color: "#57534e", whiteSpace: "pre-wrap", lineHeight: "1.6", marginBottom: "16px" } satisfies Partial<CSSStyleDeclaration>);
    dialog.appendChild(body);

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", justifyContent: "flex-end", gap: "8px" } satisfies Partial<CSSStyleDeclaration>);

    const mkBtn = (label: string, primary: boolean, onClick: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      Object.assign(b.style, {
        border: "1px solid " + (primary ? (opts.danger ? "#dc2626" : "#0ea5e9") : "#d6d3d1"),
        background: primary ? (opts.danger ? "#dc2626" : "#0ea5e9") : "#fff",
        color: primary ? "#fff" : "#44403c",
        borderRadius: "6px",
        padding: "6px 14px",
        fontSize: "13px",
        cursor: "pointer",
      } satisfies Partial<CSSStyleDeclaration>);
      b.onclick = (e) => { e.stopPropagation(); onClick(); };
      return b;
    };

    const done = (v: boolean) => { overlay.remove(); resolve(v); };
    actions.appendChild(mkBtn(opts.cancelText || "取消", false, () => done(false)));
    actions.appendChild(mkBtn(opts.confirmText || "確定", true, () => done(true)));
    dialog.appendChild(actions);

    overlay.appendChild(dialog);
    overlay.onclick = () => done(false);
    dialog.onclick = (e) => e.stopPropagation();
    root.appendChild(overlay);
  });
}

export function uiPrompt(message: string, opts: { title?: string; confirmText?: string; cancelText?: string; placeholder?: string; defaultValue?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const root = _ensureContainer();
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9998",
      background: "rgba(0,0,0,.25)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "auto",
    } satisfies Partial<CSSStyleDeclaration>);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    Object.assign(dialog.style, {
      background: "#fff",
      border: "1px solid #e7e5e4",
      borderRadius: "10px",
      boxShadow: "0 12px 32px rgba(0,0,0,.18)",
      padding: "18px 20px",
      maxWidth: "400px",
      width: "calc(100vw - 48px)",
      fontFamily: "inherit",
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement("div");
    title.textContent = opts.title || "輸入";
    Object.assign(title.style, { fontWeight: "600", fontSize: "14px", color: "#1c1917", marginBottom: "8px" } satisfies Partial<CSSStyleDeclaration>);
    dialog.appendChild(title);

    const body = document.createElement("div");
    body.textContent = String(message ?? "");
    Object.assign(body.style, { fontSize: "13px", color: "#57534e", whiteSpace: "pre-wrap", lineHeight: "1.6", marginBottom: "10px" } satisfies Partial<CSSStyleDeclaration>);
    dialog.appendChild(body);

    const input = document.createElement("input");
    input.type = "text";
    input.value = opts.defaultValue ?? "";
    input.placeholder = opts.placeholder || "";
    Object.assign(input.style, {
      width: "100%",
      boxSizing: "border-box",
      border: "1px solid #d6d3d1",
      borderRadius: "6px",
      padding: "7px 10px",
      fontSize: "13px",
      marginBottom: "16px",
      outline: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    dialog.appendChild(input);

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", justifyContent: "flex-end", gap: "8px" } satisfies Partial<CSSStyleDeclaration>);

    const mkBtn = (label: string, primary: boolean, onClick: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      Object.assign(b.style, {
        border: "1px solid " + (primary ? "#0ea5e9" : "#d6d3d1"),
        background: primary ? "#0ea5e9" : "#fff",
        color: primary ? "#fff" : "#44403c",
        borderRadius: "6px",
        padding: "6px 14px",
        fontSize: "13px",
        cursor: "pointer",
      } satisfies Partial<CSSStyleDeclaration>);
      b.onclick = (e) => { e.stopPropagation(); onClick(); };
      return b;
    };

    const done = (v: string | null) => { overlay.remove(); resolve(v); };
    actions.appendChild(mkBtn(opts.cancelText || "取消", false, () => done(null)));
    actions.appendChild(mkBtn(opts.confirmText || "確定", true, () => done(input.value)));
    dialog.appendChild(actions);

    input.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(input.value); }
      if (e.key === "Escape") { e.preventDefault(); done(null); }
    };

    overlay.appendChild(dialog);
    overlay.onclick = () => done(null);
    dialog.onclick = (e) => e.stopPropagation();
    root.appendChild(overlay);
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}
