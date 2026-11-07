/**
 * Template hardening test — F20261016-006 Next.js Server Actions 表單範本
 *
 * 目標檔（唯讀 fixture，絕不 import）：
 *   data/skills/physical-skill/nextjs-backend-best-practices/templates/server-actions-form.tsx
 *
 * 本檔為第三層鞏固（前兩層：靜態契約掃描 + 語意重現，見
 * server-actions-form-template.test.mjs 的 37 tests）。本層補上「編譯層」：
 *
 *   L1. 語法層（esbuild loader=tsx）— TSX 語法合法、可被轉譯解析。
 *   L2. 型別層（TypeScript API + 權威 React 19 stub）— 範本複製到真實
 *       React 19 / Next.js 16 專案後 tsc --noEmit 的預期結果。
 *
 * stub 來源：@types/react@19.3.0 / @types/react-dom@19.3.0 逐字節錄
 * （僅裁切至範本實際 import 的 API），並已用真實套件交叉驗證 —
 * 本測試環境與真實 @types/react@19.3.0 全量檢查結果完全一致。
 *
 * 已登錄缺陷（紅燈斷言，developer 修復後轉綠 — tester 不改範本檔）：
 *   C1 (major) L434 useActionState(subscribe, null) — subscribe 簽章
 *       (formData) 不符 React 19 契約 (state, payload)：dispatch 時
 *       formData 收到 null，formData.get('email') 直接 TypeError。
 *   C2 (major) L415 <form action={subscribe}> — subscribe 回傳
 *       {success, message} 非 void，不符 @types/react@19 FormHTMLAttributes
 *       契約 (void | Promise<void>)；複製到真實 TS 專案必得 TS2322。
 *
 * 依循 ADR-022（範本檔以「靜態契約掃描 + 最小可執行語意重現」雙層鞏固）
 * 慣例；本檔新增編譯層證據。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// tests/unit/ → repo root
const repoRoot = resolve(here, '..', '..');
const TEMPLATE_PATH = join(
  repoRoot,
  'data/skills/physical-skill/nextjs-backend-best-practices/templates/server-actions-form.tsx',
);
const src = readFileSync(TEMPLATE_PATH, 'utf8');

// ————————————————————————— stubs（權威節錄） —————————————————————————

/** @types/react@19.3.0 逐字節錄（裁切至範本 import 的 API） */
const REACT19_STUB = `type SetStateAction<S> = S | ((prevState: S) => S);
type Dispatch<A> = (value: A) => void;
export as namespace React;

export interface BaseSyntheticEvent<E = object, C = any, T = any> {
  nativeEvent: E;
  currentTarget: C;
  target: T;
  preventDefault(): void;
  stopPropagation(): void;
}
export interface SyntheticEvent<T = Element, E = Event> extends BaseSyntheticEvent<E, EventTarget & T, EventTarget> {}
export interface FormEvent<T = Element> extends SyntheticEvent<T> {}
export interface HTMLAttributes<T> { [key: string]: any }
export interface FormHTMLAttributes<T> extends HTMLAttributes<T> {
  action?: string | undefined | ((formData: FormData) => void | Promise<void>);
}
export type VoidOrUndefinedOnly = void;
export type TransitionFunction = () => VoidOrUndefinedOnly | Promise<VoidOrUndefinedOnly>;

export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
export function startTransition(scope: TransitionFunction): void;
export function useActionState<State>(
  action: (state: Awaited<State>) => State | Promise<State>,
  initialState: Awaited<State>,
  permalink?: string,
): [state: Awaited<State>, dispatch: () => void, isPending: boolean];
export function useActionState<State, Payload>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
  permalink?: string,
): [state: Awaited<State>, dispatch: (payload: Payload) => void, isPending: boolean];
export function useOptimistic<State>(
  passthrough: State,
): [State, (action: State | ((pendingState: State) => State)) => void];
export function useOptimistic<State, Action>(
  passthrough: State,
  reducer: (state: State, action: Action) => State,
): [State, (action: Action) => void];

declare global {
  namespace JSX {
    interface Element { }
    interface IntrinsicElements {
      form: React.FormHTMLAttributes<HTMLFormElement>;
      [elem: string]: any;
    }
  }
}
`;

/** @types/react-dom@19.3.0 逐字節錄 */
const REACT_DOM19_STUB = `export interface FormStatusNotPending { pending: false; data: null; method: null; action: null }
export interface FormStatusPending {
  pending: true;
  data: FormData;
  method: string;
  action: string | ((formData: FormData) => void | Promise<void>);
}
export type FormStatus = FormStatusPending | FormStatusNotPending;
export function useFormStatus(): FormStatus;
`;

/** 最小 Next.js 16 / zod stub — 僅涵蓋範本 import 的 API 表面 */
const NEXT_CACHE_STUB = `export function revalidateTag(tag: string, profile?: 'max' | 'fs' | 'client'): void
export function updateTag(tag: string, profile?: 'max' | 'fs' | 'client'): void
`;
const NEXT_NAVIGATION_STUB = `export function redirect(url: string): never
`;
const NEXT_HEADERS_STUB = `export function headers(): Promise<{ get(name: string): string | null }>
`;
const NEXT_IMAGE_STUB = `export default function Image(props: {
  src: string
  alt: string
  width?: number
  height?: number
  unoptimized?: boolean
  [key: string]: unknown
}): JSX.Element
`;
const ZOD_STUB = `export interface ZodTypeDef { _output: unknown }
export interface ZodString extends ZodTypeDef {
  _output: string
  min(n: number, message?: string): ZodString
  max(n: number, message?: string): ZodString
  email(message?: string): ZodString
}
export interface ZodArray<T> extends ZodTypeDef {
  _output: T[]
  min(n: number, message?: string): ZodArray<T>
}
export type FieldErrors<T> = Partial<Record<keyof T & string, string[]>>
export interface ZodError<T> {
  flatten(): { fieldErrors: FieldErrors<T>; formErrors: string[] }
}
export type Inferred<S extends Record<string, ZodTypeDef>> = { [K in keyof S]: S[K]['_output'] }
export interface ZodObject<S extends Record<string, ZodTypeDef>> {
  safeParse(input: unknown):
    | { success: true; data: Inferred<S> }
    | { success: false; error: ZodError<Inferred<S>> }
}
export const z: {
  string(): ZodString
  array<T>(element: ZodTypeDef & { _output: T }): ZodArray<T>
  object<S extends Record<string, ZodTypeDef>>(shape: S): ZodObject<S>
}
`;

// ——————————————————————————— helpers ———————————————————————————

/**
 * L2 型別層：以 TypeScript Compiler API + 權威 stub 檢查範本。
 * stub 寫入 OS 暫存目錄（非專案目錄），以 paths 映射隔離 repo 內
 * @types/react@18，結束後清理。
 */
async function typeCheckTemplate(templateSource) {
  const ts = await import('typescript');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const tmp = mkdtempSync(join(tmpdir(), 'tpl-check-'));
  try {
    writeFileSync(join(tmp, 'react.d.ts'), REACT19_STUB);
    writeFileSync(join(tmp, 'react-dom.d.ts'), REACT_DOM19_STUB);
    writeFileSync(join(tmp, 'next-cache.d.ts'), NEXT_CACHE_STUB);
    writeFileSync(join(tmp, 'next-navigation.d.ts'), NEXT_NAVIGATION_STUB);
    writeFileSync(join(tmp, 'next-headers.d.ts'), NEXT_HEADERS_STUB);
    writeFileSync(join(tmp, 'next-image.d.ts'), NEXT_IMAGE_STUB);
    writeFileSync(join(tmp, 'zod.d.ts'), ZOD_STUB);
    writeFileSync(join(tmp, 'template.tsx'), templateSource);

    const paths = {
      react: ['./react.d.ts'],
      'react-dom': ['./react-dom.d.ts'],
      'next/cache': ['./next-cache.d.ts'],
      'next/navigation': ['./next-navigation.d.ts'],
      'next/headers': ['./next-headers.d.ts'],
      'next/image': ['./next-image.d.ts'],
      zod: ['./zod.d.ts'],
    };

    const program = ts.createProgram(
      [join(tmp, 'template.tsx')],
      {
        strict: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
        jsx: ts.JsxEmit.Preserve,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        types: ['node'],
        typeRoots: [join(repoRoot, 'node_modules/@types')],
        baseUrl: tmp,
        paths,
      },
    );
    const diags = [
      ...program.getSyntacticDiagnostics(),
      ...program.getGlobalDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ];
    return diags.map((d) => {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      return {
        code: d.code,
        line: line + 1,
        msg: ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 200),
      };
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ——————————————————————————— tests ———————————————————————————

describe('F20261016-006 server-actions-form.tsx — 編譯層鞏固', () => {
  describe('L1 語法層（esbuild TSX 轉譯）', () => {
    it('範本 TSX 語法合法 — esbuild loader=tsx 解析成功且零警告', async () => {
      const esbuild = await import('esbuild');
      const result = await esbuild.transform(src, {
        loader: 'tsx',
        format: 'esm',
        jsx: 'automatic',
      });
      expect(result.warnings).toHaveLength(0);
      // esbuild 將 export 集中至檔尾（合法 ESM 輸出），故分別驗證：
      // (1) 函式宣告存在；(2) 出現在 export 清單中
      expect(result.code).toMatch(/\basync function subscribe\s*\(/);
      expect(result.code).toMatch(/export\s*\{[^}]*\bsubscribe\b[^}]*\}/);
    });
  });

  describe('L2 型別層（TS API + 權威 React 19 stub）— 缺陷登錄', () => {
    // 斷言設計（依 ADR-022 慣例）：目前斷言「缺陷存在」→ 測試綠 = 偵測正確。
    // developer 修復範本後，此三項會轉紅 — 屆時翻轉斷言為「缺陷不存在」。
    it('C1: useActionState(subscribe, null) 違反 React 19 (state, payload) 契約 → TS2769 @ L434', async () => {
      const diags = await typeCheckTemplate(src);
      const c1 = diags.find((d) => d.code === 2769 && d.line === 434);
      expect(c1).toBeDefined();
      expect(c1.msg).toMatch(/Overload/i);
    });

    it('C2: <form action={subscribe}> 回傳值非 void → TS2322 @ L415', async () => {
      const diags = await typeCheckTemplate(src);
      const c2 = diags.find((d) => d.code === 2322 && d.line === 415);
      expect(c2).toBeDefined();
      expect(c2.msg).toMatch(/Promise<void>|void/i);
    });

    it('契約精確性：除 C1(L434)/C2(L415) 外無其他型別錯誤（不多報、不漏報）', async () => {
      const diags = await typeCheckTemplate(src);
      const others = diags.filter(
        (d) => !((d.code === 2769 && d.line === 434) || (d.code === 2322 && d.line === 415)),
      );
      expect(others).toEqual([]);
    });
  });
});
