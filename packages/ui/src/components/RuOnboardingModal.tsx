/**
 * RuOnboardingModal — 🎉 Release Unit onboarding 三步 wizard
 *
 * 2026-09-06 Fleming：改逐步 wizard（原本一次攤三區塊+完成鈕會讓人搞混）。
 * Step 1 機器掃描結果 → Step 2 Skill 建議 → Step 3 CU
 * 最後一步主按鈕 =「🚀 開始 Scan」— 觸發 CU 進度 modal（不是完成收尾）。
 *
 * 自動靜音：CU 已跑 + 沒有新建議（舊 RU 重複 import）→ 不顯示直接關。
 * 事實來源：GET /api/coding-project/skill-suggest + GET /api/coding-project/cu-status
 */
import React, { useState, useEffect } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import SkillSuggestModal from "./SkillSuggestModal";

interface StackInfo { id: string; kind: string; label: string; evidence: string }
interface Props {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; text: string };
  onClose: () => void;
  onOpenEm?: () => void;
  /** Step 3 主按鈕「開始 Scan」— 呼叫端負責：切到 dashboard + 觸發 CU + 關 wizard */
  onStartCu?: () => void;
}

const KIND_ICON: Record<string, string> = { language: "🔤", framework: "🧩", infra: "🏗️", test: "🧪" };

export default function RuOnboardingModal({ rootPath, theme: t, onClose, onOpenEm, onStartCu }: Props) {
  const { t: i18n } = useI18n();
  const [phase, setPhase] = useState<"loading" | "show" | "skip">("loading");
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [cuDoneCount, setCUDoneCount] = useState<number | null>(null);
  const [showSkills, setShowSkills] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ssRes, cuRes] = await Promise.all([
          fetch(`${API_BASE}/api/coding-project/skill-suggest?path=${encodeURIComponent(rootPath)}`),
          fetch(`${API_BASE}/api/coding-project/cu-status?path=${encodeURIComponent(rootPath)}`),
        ]);
        const ss = await ssRes.json();
        const cu = await cuRes.json().catch(() => ({}));
        if (!alive) return;
        const n = ss?.summary?.newCount ?? 0;
        const cuDone = typeof cu?.doneCount === "number" ? cu.doneCount : null;
        // 舊 RU（CU 跑過 + 沒新建議）→ 靜音不打擾
        if (cuDone !== null && cuDone > 0 && n === 0) { setPhase("skip"); return; }
        setStacks(ss?.detection?.stacks || []);
        setNewCount(n);
        setCUDoneCount(cuDone);
        setPhase("show");
      } catch {
        if (alive) setPhase("show"); // 掃描失敗也要讓人關掉
      }
    })();
    return () => { alive = false; };
  }, [rootPath]);

  useEffect(() => { if (phase === "skip") onClose(); }, [phase, onClose]);

  if (phase !== "show") {
    // loading / skip：skip 由 useEffect 關掉，這裡只渲染 loading
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.35)" }}>
        <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 text-xs text-stone-400 animate-pulse">{i18n("ss.loading")}</div>
      </div>
    );
  }

  const cuDone = cuDoneCount ?? 0;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" style={{ border: `1px solid ${t.borderLight}` }} onClick={e => e.stopPropagation()}>
          <div className="px-5 py-3.5 border-b" style={{ borderColor: t.borderLight, background: t.bgMuted }}>
            <div className="text-sm font-bold text-stone-800">🎉 {i18n("ru.onboardingTitle")}</div>
            <div className="text-[11px] text-stone-500 mt-0.5 font-mono truncate">{rootPath}</div>
          </div>

          {/* Stepper：三步進度條 */}
          <div className="px-5 pt-4 pb-1 flex items-center gap-2">
            {[1, 2, 3].map(s => (
              <div key={s} className="flex-1 flex items-center gap-2">
                <div className={`flex-1 h-1.5 rounded-full transition-colors ${wizardStep >= s ? "" : "bg-stone-200"}`} style={wizardStep >= s ? { background: t.accent } : undefined} />
              </div>
            ))}
          </div>
          <div className="px-5 pb-2 text-[10px] text-stone-400">{i18n("ru.obWizardHint").replace("{n}", String(wizardStep))}</div>

          <div className="px-5 py-3 min-h-[132px]">
            {/* ── Step 1：機器掃描 ── */}
            {wizardStep === 1 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold flex items-center justify-center shrink-0">1</span>
                  <span className="text-xs font-bold text-stone-700">{i18n("ru.obScan")}</span>
                  <span className="text-[10px] text-stone-400 ml-auto">{stacks.length > 0 ? i18n("ru.obScanDone").replace("{n}", String(stacks.length)) : i18n("ss.detectEmpty")}</span>
                </div>
                {stacks.length > 0 ? (
                  <div className="flex flex-wrap gap-1 ml-7">
                    {stacks.slice(0, 8).map(s => (
                      <span key={s.id} title={s.evidence} className={`text-[10px] px-2 py-0.5 rounded-full border ${s.kind === "language" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`} style={{ borderColor: t.borderLight }}>
                        {KIND_ICON[s.kind] || "📦"} {s.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-stone-400 ml-7">{i18n("ss.detectEmpty")}</div>
                )}
              </div>
            )}

            {/* ── Step 2：Skill 建議 ── */}
            {wizardStep === 2 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${newCount > 0 ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-400"}`}>2</span>
                  <span className="text-xs font-bold text-stone-700">{i18n("ru.obSkill")}</span>
                </div>
                <div className="ml-7 space-y-2">
                  <div className="text-[10px] text-stone-400">{newCount > 0 ? i18n("ru.obSkillNew").replace("{n}", String(newCount)) : i18n("ru.obSkillOk")}</div>
                  {newCount > 0 && (
                    <button onClick={() => setShowSkills(true)}
                      className="text-[11px] px-3 py-1.5 rounded-lg border bg-white hover:bg-stone-50 text-stone-600" style={{ borderColor: t.borderLight }}>
                      💡 {i18n("ru.obSkillBtn")}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 3：CU — 主按鈕「開始 Scan」── */}
            {wizardStep === 3 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${cuDone > 0 ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-400"}`}>3</span>
                  <span className="text-xs font-bold text-stone-700">{i18n("ru.obCu")}</span>
                </div>
                <div className="ml-7 space-y-2">
                  <div className="text-[10px] text-stone-400">{cuDone > 0 ? i18n("ru.obCuDone").replace("{n}", String(cuDone)) : i18n("ru.obCuPending")}</div>
                  {onOpenEm && (
                    <button onClick={() => { onOpenEm(); onClose(); }}
                      className="text-[11px] px-3 py-1.5 rounded-lg border bg-white hover:bg-stone-50 text-stone-600" style={{ borderColor: t.borderLight }}>
                      🎖️ {i18n("ru.obCuBtn")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: t.borderLight, background: t.bgMuted }}>
            <span className="text-[10px] text-stone-400">{i18n("ru.obFreshHint")}</span>
            <div className="flex items-center gap-2">
              {wizardStep > 1 && (
                <button onClick={() => setWizardStep(wizardStep === 3 ? 2 : 1)}
                  className="text-xs px-3 py-1.5 rounded-lg border bg-white hover:bg-stone-50 text-stone-600" style={{ borderColor: t.borderLight }}>
                  {i18n("ru.obBack")}
                </button>
              )}
              {wizardStep < 3 ? (
                <button onClick={() => setWizardStep(wizardStep === 1 ? 2 : 3)}
                  className="text-xs px-4 py-1.5 rounded-lg text-white font-semibold" style={{ background: t.accent }}>
                  {i18n("ru.obNext")} →
                </button>
              ) : onStartCu ? (
                <>
                  <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border bg-white hover:bg-stone-50 text-stone-600" style={{ borderColor: t.borderLight }}>
                    {i18n("ru.obLater")}
                  </button>
                  <button onClick={onStartCu} className="text-xs px-4 py-1.5 rounded-lg text-white font-semibold" style={{ background: t.accent }}>
                    {i18n("ru.obStartScan")}
                  </button>
                </>
              ) : (
                <button onClick={onClose} className="text-xs px-4 py-1.5 rounded-lg text-white font-semibold" style={{ background: t.accent }}>
                  {i18n("ru.obDone")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showSkills && (
        <SkillSuggestModal rootPath={rootPath} theme={t} onClose={() => setShowSkills(false)} />
      )}
    </>
  );
}
