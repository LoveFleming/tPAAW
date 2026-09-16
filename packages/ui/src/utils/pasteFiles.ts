/**
 * Clipboard paste helpers（2026-09-16）
 *
 * 解決：browser 照相後「複製圖片」→ chat 輸入框 Ctrl+V 貼出文字而不是圖片。
 * 原因：原本只看 clipboardData.files；Safari/部分複製來源只給 items，
 * 或圖片只存在 text/html 的 <img src> 裡（data: 或同源 http URL）。
 *
 * 優先序：files → items(kind=file) → text/html 內嵌圖。
 * 有 text/plain 內容時不攔（一般文字/混合選取貼上，行為不變）。
 */

/** 同步判斷：這次 paste 有沒有機會是圖片（要在 default paste 發生前決定 preventDefault） */
export function pasteMayContainImage(cd: DataTransfer | null): boolean {
  if (!cd) return false;
  if ((cd.files?.length || 0) > 0) return true;
  const items = Array.from(cd.items || []);
  if (items.some(i => i.kind === "file")) return true;
  // 無檔案形態：只有純文字時不攔；text/html 帶 <img> 且無純文字 → 視為圖片複製
  const hasPlainText = (cd.getData("text/plain") || "").trim().length > 0;
  if (hasPlainText) return false;
  const html = cd.getData("text/html") || "";
  return /<img[^>]+src=["'](?:data:image\/|https?:\/\/)/i.test(html);
}

/**
 * 抽出剪貼簿裡的圖片/檔案。回傳 null = 不是檔案貼上（讓瀏覽器走預設行為）。
 * 注意：呼叫前先用 pasteMayContainImage() 判斷並 preventDefault，再 await 這個。
 */
export async function extractPasteFiles(cd: DataTransfer | null): Promise<File[] | null> {
  if (!cd) return null;
  // 1) FileList — Chrome 截圖 / 複製圖片 / 拖入檔案
  const files = Array.from(cd.files || []);
  if (files.length > 0) return files;
  // 2) items fallback — Safari 等只給 items
  const itemFiles = Array.from(cd.items || [])
    .filter(i => i.kind === "file")
    .map(i => i.getAsFile())
    .filter((f): f is File => !!f);
  if (itemFiles.length > 0) return itemFiles;
  // 3) 有純文字 → 不攔（含「複製圖片位址」這種文字貼上）
  if ((cd.getData("text/plain") || "").trim()) return null;
  // 4) text/html 內嵌 data:image → 直接解 base64 轉 File
  const html = cd.getData("text/html") || "";
  const m = html.match(/<img[^>]+src=["'](data:image\/(png|jpe?g|webp|gif);base64,[^"']+)["']/i);
  if (m) {
    try {
      const res = await fetch(m[1]);
      const blob = await res.blob();
      const ext = /png/i.test(m[2]) ? "png" : /gif/i.test(m[2]) ? "gif" : /webp/i.test(m[2]) ? "webp" : "jpg";
      return [new File([blob], `paste-${Date.now()}.${ext}`, { type: blob.type })];
    } catch { /* fall through */ }
  }
  // 5) text/html 內嵌 http 圖片 URL（例如本機 /api/browser/screenshot）→ 抓回轉 File
  const mu = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  if (mu) {
    try {
      const res = await fetch(mu[1]);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.type.startsWith("image/")) {
          const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
          return [new File([blob], `paste-${Date.now()}.${ext}`, { type: blob.type })];
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}
