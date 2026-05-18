import Icon from "../components/Icon";
import React, { useState } from "react";
import errorCodeRules from "../data/factory-standards/error-code-rules-v1.json";
import factoryManifesto from "../data/factory-standards/factory-manifesto.json";

/* ── Types ── */
interface StandardSection {
  id: string;
  title: string;
  description?: string;
  [key: string]: unknown;
}

interface FactoryStandard {
  id: string;
  title: string;
  version: string;
  category: string;
  tags: string[];
  description: string;
  source: string;
  sections: StandardSection[];
}

/* ── Helpers ── */
const CATEGORY_COLORS: Record<string, string> = {
  "coding-standards": "bg-blue-100 text-blue-700",
  "manifesto": "bg-amber-100 text-amber-700",
  "error-handling": "bg-red-100 text-red-700",
  "architecture": "bg-purple-100 text-purple-700",
  "testing": "bg-green-100 text-green-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  "coding-standards": "Coding Standards",
  "manifesto": "宣言",
  "error-handling": "Error Handling",
  "architecture": "Architecture",
  "testing": "Testing",
};

/* ── All standards ── */
const ALL_STANDARDS: FactoryStandard[] = [
  errorCodeRules as unknown as FactoryStandard,
  factoryManifesto as unknown as FactoryStandard,
];

/* ── Sub-components ── */

function SectionCard({ section, standardId }: { section: StandardSection; standardId: string }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Object.keys(section).some(
    k => !["id", "title", "description"].includes(k)
  );

  return (
    <div className="border border-zinc-200 rounded-lg bg-white hover:shadow-sm transition-shadow">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`w-full text-left px-4 py-3 flex items-center justify-between ${
          hasDetails ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <div>
          <h4 className="font-semibold text-sm text-zinc-800">{section.title}</h4>
          {section.description && (
            <p className="text-xs text-zinc-500 mt-0.5">{section.description}</p>
          )}
        </div>
        {hasDetails && (
          <svg
            className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        )}
      </button>

      {expanded && hasDetails && (
        <div className="px-4 pb-4 border-t border-zinc-100">
          <SectionDetail section={section} standardId={standardId} />
        </div>
      )}
    </div>
  );
}

function SectionDetail({ section, standardId }: { section: StandardSection; standardId: string }) {
  // Error Code Rules specific rendering
  if (standardId === "error-code-rules-v1") {
    return <ErrorCodeDetail section={section} />;
  }
  // Manifesto
  if (standardId === "factory-manifesto") {
    return <ManifestoDetail section={section} />;
  }
  // Generic fallback
  return (
    <pre className="text-xs bg-zinc-50 rounded p-3 overflow-x-auto">
      {JSON.stringify(section, null, 2)}
    </pre>
  );
}

function ErrorCodeDetail({ section }: { section: StandardSection }) {
  const s = section as Record<string, unknown>;

  // ErrorType mappings
  if (s.mappings) {
    const mappings = s.mappings as Array<{ type: string; httpStatus: number }>;
    return (
      <div className="mt-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="pb-2 font-medium">ErrorType</th>
              <th className="pb-2 font-medium">HTTP Status</th>
              <th className="pb-2 font-medium">Color</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.type} className="border-t border-zinc-100">
                <td className="py-1.5 font-mono text-blue-600">{m.type}</td>
                <td className="py-1.5 font-mono">{m.httpStatus}</td>
                <td className="py-1.5">
                  <span className={`inline-block w-3 h-3 rounded-full ${
                    m.httpStatus >= 500 ? "bg-red-400" :
                    m.httpStatus >= 400 ? "bg-amber-400" :
                    "bg-green-400"
                  }`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // CODE_CLASS / AREA values
  if (s.values) {
    const values = s.values as Array<{ code: string; meaning: string }>;
    return (
      <div className="mt-3 space-y-2">
        {values.map((v) => (
          <div key={v.code} className="flex items-start gap-3">
            <code className="bg-zinc-100 text-purple-700 px-2 py-0.5 rounded text-xs font-mono shrink-0">
              {v.code}
            </code>
            <span className="text-xs text-zinc-600">{v.meaning}</span>
          </div>
        ))}
        {typeof s.note === "string" && (
          <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
            <Icon name="warning" size={14} className="inline text-amber-500" /> {s.note}
          </div>
        )}
      </div>
    );
  }

  // FAMILY groups
  if (s.groups) {
    const groups = s.groups as Array<{ area: string; families: string[] }>;
    return (
      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <div key={g.area}>
            <div className="text-xs font-semibold text-zinc-600 mb-1">{g.area}</div>
            <div className="flex flex-wrap gap-1.5">
              {g.families.map((f) => (
                <span key={f} className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-xs font-mono">
                  {f}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Examples (code blocks)
  if (s.examples) {
    const examples = s.examples as string[];
    return (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {examples.map((ex) => (
          <code key={ex} className="bg-zinc-100 text-emerald-700 px-2 py-1 rounded text-xs font-mono">
            {ex}
          </code>
        ))}
      </div>
    );
  }

  // Steps (decision order)
  if (s.steps) {
    const steps = s.steps as string[];
    return (
      <div className="mt-3 space-y-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
              {i + 1}
            </span>
            <span className="text-xs text-zinc-700">{step}</span>
          </div>
        ))}
      </div>
    );
  }

  // Rules (naming style)
  if (s.rules) {
    const rules = s.rules as string[];
    return (
      <ul className="mt-3 space-y-1.5">
        {rules.map((rule, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-zinc-700">
            <span className="text-blue-500 mt-0.5"><Icon name="check" size={14} /></span>
            {rule}
          </li>
        ))}
      </ul>
    );
  }

  // Principles (exception flow)
  if (s.principles) {
    const principles = s.principles as string[];
    return (
      <ul className="mt-3 space-y-1.5">
        {principles.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-zinc-700">
            <span className="text-amber-500 mt-0.5"><Icon name="star" size={14} /></span>
            {p}
          </li>
        ))}
      </ul>
    );
  }

  // Prefixes (boot/init/startup)
  if (s.prefixes) {
    const prefixes = s.prefixes as string[];
    return (
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          {prefixes.map((p) => (
            <code key={p} className="bg-red-50 text-red-700 px-2 py-1 rounded text-xs font-mono">
              {p}
            </code>
          ))}
        </div>
      </div>
    );
  }

  // Constraints (summary)
  if (s.constraints) {
    const constraints = s.constraints as Record<string, string>;
    return (
      <div className="mt-3 space-y-2">
        {Object.entries(constraints).map(([key, val]) => (
          <div key={key} className="flex items-center gap-3">
            <code className="bg-zinc-100 text-purple-700 px-2 py-0.5 rounded text-xs font-mono">{key}</code>
            <span className="text-xs text-zinc-500">=</span>
            <code className="text-xs font-mono text-emerald-700">{val}</code>
          </div>
        ))}
        {(s.format as string) && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
            <div className="text-xs text-blue-500 font-medium mb-1">Format</div>
            <code className="text-sm font-mono text-blue-800">{s.format as string}</code>
          </div>
        )}
      </div>
    );
  }

  // Format only
  if (s.format && !s.constraints) {
    return (
      <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
        <code className="text-sm font-mono text-blue-800">{s.format as string}</code>
      </div>
    );
  }

  return null;
}

function ManifestoDetail({ section }: { section: StandardSection }) {
  const s = section as Record<string, unknown>;
  if (s.principles) {
    const principles = s.principles as string[];
    return (
      <ul className="mt-3 space-y-1.5">
        {principles.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-zinc-700">
            <span className="text-blue-500 mt-0.5">●</span>
            {p}
          </li>
        ))}
      </ul>
    );
  }
  return null;
}

/* ── Main Page ── */
export default function FactoryStandards({ initialTab }: { initialTab?: string }) {
  const [selectedId, setSelectedId] = useState<string>(
    initialTab === "manifesto" && ALL_STANDARDS.length > 1 ? ALL_STANDARDS[1].id : ALL_STANDARDS[0].id
  );
  const selected = ALL_STANDARDS.find(s => s.id === selectedId) ?? ALL_STANDARDS[0];

  return (
    <div className="h-full overflow-y-auto px-6">
      <div className="max-w-5xl mx-auto py-6 px-2">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-2xl"><Icon name="clipboard" size={24} /></span>
            <h1 className="text-xl font-bold text-zinc-800">Factory</h1>
          </div>
          <p className="text-sm text-zinc-500 ml-10">
            軟體工廠的宣言、制度與規範 — AI 員工與人類工程師的共同參考
          </p>
        </div>

        <div className="flex gap-6">
          {/* Left: Standard list */}
          <div className="w-72 shrink-0 space-y-2">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Documents</h3>
            {ALL_STANDARDS.map(std => (
              <button
                key={std.id}
                onClick={() => setSelectedId(std.id)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedId === std.id
                    ? "bg-blue-50 border-blue-200 shadow-sm"
                    : "bg-white border-zinc-200 hover:border-zinc-300 hover:shadow-sm"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    CATEGORY_COLORS[std.category] ?? "bg-zinc-100 text-zinc-600"
                  }`}>
                    {CATEGORY_LABELS[std.category] ?? std.category}
                  </span>
                  <span className="text-[10px] text-zinc-400">v{std.version}</span>
                </div>
                <div className="font-medium text-sm text-zinc-800">{std.title}</div>
                <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{std.description}</div>
              </button>
            ))}

            {/* Info box */}
            <div className="mt-4 p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
              <div className="text-xs font-medium text-zinc-500 mb-1 flex items-center gap-1"><Icon name="pin" size={12} /> About this space</div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                這裡收集軟體工廠的所有靜態規範文件。AI 員工在執行任務時可參考這些規則，
                人類工程師也可以在這裡查閱最新標準。
              </p>
            </div>
          </div>

          {/* Right: Standard detail */}
          <div className="flex-1 min-w-0">
            <div className="bg-white border border-zinc-200 rounded-xl shadow-sm">
              {/* Detail header */}
              <div className="p-5 border-b border-zinc-100">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-lg font-bold text-zinc-800">{selected.title}</h2>
                  <span className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full">
                    v{selected.version}
                  </span>
                </div>
                <p className="text-sm text-zinc-600">{selected.description}</p>
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex gap-1.5">
                    {selected.tags.map(tag => (
                      <span key={tag} className="text-[10px] bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    Source: {selected.source}
                  </span>
                </div>
              </div>

              {/* Sections */}
              <div className="p-5 space-y-3">
                {selected.sections.map(section => (
                  <SectionCard key={section.id} section={section} standardId={selected.id} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
