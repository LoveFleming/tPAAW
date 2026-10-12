/**
 * ChatInputBar — 對話輸入列（共用元件，2026-10-09 Fleming 要求林雨晴 chat 與 coding app agent chat 完全一致）
 *
 * 一份實作、兩處使用（ChatView 主聊天 / AgentSideChat 側欄 agent chat）→ 永久不會走鐘。
 *
 * 功能：文字框（IME 三層保護）、🖼️ 貼圖、📄 文字檔、拖放、貼上、待送預覽、送出／中斷。
 * 透過 ref 暴露 addFiles(files)（供外部注入，如 Handover QA chips）。
 */
import React, { useState, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { pasteMayContainImage, extractPasteFiles } from "../utils/pasteFiles";
import { useI18n } from "../i18n";
import { uiAlert, uiAlertError } from "./ui/uiFeedback";

export interface PendingImage { id: string; dataUrl: string; }
export interface PendingFile { id: string; name: string; size: number; text: string; }

export interface ChatInputBarHandle {
  addFiles: (files: File[]) => void;
  setText: (text: string) => void;
  focus: () => void;
}

interface Props {
  placeholder: string;
  accent: string;
  loading: boolean;
  onSubmit: (payload: { text: string; images: PendingImage[]; files: PendingFile[] }) => void;
  onStop?: () => void;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 4;

const ChatInputBar = forwardRef<ChatInputBarHandle, Props>(function ChatInputBar(
  { placeholder, accent, loading, onSubmit, onStop }, ref
) {
  const { t: tt } = useI18n();
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  const readAsText = useCallback((file: File): Promise<string> => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("read fail"));
    r.readAsText(file, "utf-8");
  }), []);

  const compressImage = useCallback((file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1568;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => reject(new Error("image load fail"));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("file read fail"));
    reader.readAsDataURL(file);
  }), []);

  const addImages = useCallback(async (files: File[]) => {
    const imgs = files.filter(f => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    const room = MAX_ITEMS - pendingImages.length;
    if (room <= 0) { uiAlert(tt("chat.imageLimit")); return; }
    const results: PendingImage[] = [];
    for (const f of imgs.slice(0, room)) {
      try { results.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, dataUrl: await compressImage(f) }); } catch {}
    }
    if (results.length > 0) setPendingImages(p => [...p, ...results].slice(0, MAX_ITEMS));
  }, [compressImage, pendingImages.length, tt]);

  const addTextFiles = useCallback(async (files: File[]) => {
    const texts = files.filter(f => !f.type.startsWith("image/"));
    if (texts.length === 0) return;
    const room = MAX_ITEMS - pendingFiles.length;
    if (room <= 0) { uiAlert(tt("chat.fileLimit")); return; }
    const results: PendingFile[] = [];
    for (const f of texts.slice(0, room)) {
      if (f.size > MAX_FILE_BYTES) { uiAlertError(`${f.name}: ${tt("chat.fileTooLarge")}`); continue; }
      try {
        const text = await readAsText(f);
        if (text.includes("\u0000")) { uiAlertError(`${f.name}: ${tt("chat.fileBinary")}`); continue; }
        results.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: f.name, size: f.size, text });
      } catch { uiAlertError(`${f.name}: ${tt("chat.fileReadFail")}`); }
    }
    if (results.length > 0) setPendingFiles(p => [...p, ...results].slice(0, MAX_ITEMS));
  }, [pendingFiles.length, readAsText, tt]);

  useImperativeHandle(ref, () => ({
    addFiles: (files: File[]) => { addImages(files); addTextFiles(files); },
    setText: (text: string) => setInput(text),
    focus: () => textareaRef.current?.focus(),
  }), [addImages, addTextFiles]);

  const submit = useCallback((text?: string) => {
    const t = (text ?? input).trim();
    if ((!t && pendingImages.length === 0 && pendingFiles.length === 0) || loading) return;
    const images = pendingImages;
    const files = pendingFiles;
    setInput("");
    setPendingImages([]);
    setPendingFiles([]);
    onSubmit({ text: t, images, files });
  }, [input, loading, pendingImages, pendingFiles, onSubmit]);

  return (
    <div className="border-t p-2 shrink-0" style={{ borderColor: "#e7e5e4" }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const files = Array.from(e.dataTransfer.files); addImages(files); addTextFiles(files); }}>
      {/* 👁 待送圖預覽 */}
      {pendingImages.length > 0 && (
        <div className="flex gap-1.5 mb-1.5 flex-wrap">
          {pendingImages.map(img => (
            <div key={img.id} className="relative group">
              <img src={img.dataUrl} alt="" className="w-14 h-14 object-cover rounded-lg border border-stone-200" />
              <button onClick={() => setPendingImages(p => p.filter(x => x.id !== img.id))} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-stone-700 text-white text-[9px] flex items-center justify-center opacity-80 hover:opacity-100">✕</button>
            </div>
          ))}
        </div>
      )}
      {/* 📄 待送文字檔預覽 */}
      {pendingFiles.length > 0 && (
        <div className="flex gap-1.5 mb-1.5 flex-wrap">
          {pendingFiles.map(f => (
            <div key={f.id} className="relative group">
              <span className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white border border-stone-200 text-[10px] text-stone-600 max-w-[220px]">
                <span>📄</span>
                <span className="truncate" title={f.name}>{f.name}</span>
                <span className="text-stone-400 shrink-0">{(f.size / 1024).toFixed(1)}KB</span>
              </span>
              <button onClick={() => setPendingFiles(p => p.filter(x => x.id !== f.id))} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-stone-700 text-white text-[9px] flex items-center justify-center opacity-80 hover:opacity-100">✕</button>
            </div>
          ))}
        </div>
      )}
      {dragOver && <div className="mb-1.5 text-[10px] px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">{tt("chat.imageDropHere")}</div>}
      <div className="flex gap-1.5 items-end">
        {/* 🖼️ 貼圖鈕 */}
        <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addImages(Array.from(e.target.files || [])); e.target.value = ""; }} />
        <button onClick={() => imageInputRef.current?.click()} disabled={pendingImages.length >= MAX_ITEMS} title={tt("chat.attachImage")}
          className="text-xs px-2 py-2 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:border-stone-300 disabled:opacity-40 shrink-0 bg-stone-50">🖼️</button>
        {/* 📄 文字檔鈕 */}
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { addTextFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={pendingFiles.length >= MAX_ITEMS} title={tt("chat.attachFile")}
          className="text-xs px-2 py-2 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-700 hover:border-stone-300 disabled:opacity-40 shrink-0 bg-stone-50">📄</button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onPaste={async (e) => {
            if (!pasteMayContainImage(e.clipboardData)) return;
            e.preventDefault();
            const files = await extractPasteFiles(e.clipboardData);
            if (files && files.length > 0) { addImages(files); addTextFiles(files); }
          }}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={e => {
            if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          rows={2}
          placeholder={placeholder}
          className="flex-1 text-sm rounded-lg border border-stone-200 px-3 py-2 resize-none focus:outline-none focus:border-stone-400 bg-white"
        />
        {loading ? (
          <button onClick={() => onStop?.()}
            className="text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 shrink-0">停止</button>
        ) : (
          <button onClick={() => submit()} disabled={!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0}
            className="text-xs px-3 py-2 rounded-lg text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: accent }}>
            送出
          </button>
        )}
      </div>
    </div>
  );
});

export default ChatInputBar;
