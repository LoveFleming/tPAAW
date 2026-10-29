/**
 * Clipboard paste helpers（2026-09-16；2026-09-26 修：截圖 URL 貼上仍變文字）
 *
 * 解決：browser 照相後複製 → chat 輸入框 Ctrl+V 貼出文字而不是圖片。
 * 已知 clipboard 形狀全表：
 *   A. 右鍵「複製圖片」/ Chrome 截圖 → files/image/png ✅（9/16 起）
 *   B. Safari/部分來源只給 items(kind=file) ✅（9/16 起）
 *   C. 圖只在 text/html 的 <img src>（data: 或 http URL）✅（9/16 起）
 *   D. ⌘C 選到 <img>、或「複製圖片」同時帶 URL → text/plain 有截圖網址 ← 9/26 前
 *      會被「有純文字就不攔」規則放行 → 貼出 URL 文字（本 bug）
 *   E. 「複製圖片位址」→ 只有一條 URL 文字
 *
 * 9/26 規則：剪貼簿有圖檔 → 一律攔（圖優先，不管有沒有純文字）；
 * 純文字內容若是本 app 的 /api/browser/screenshot|shot URL（D/E 形狀）→ 也攔，抓回轉成圖。
 * 一般文字/混合選取貼上行為不變。
 */

/** 純文字是否就是一條截圖 URL（D/E 形狀） */
function isShotUrl(s: string): boolean {
  if (!s || /\s/.test(s)) return false;
  return /^(https?:\/\/[^\s]*)?\/api\/browser\/(screenshot|shot)([?#][^\s]*)?$/.test(s);
}

/** 同步判斷：這次 paste 有沒有機會是圖片（要在 default paste 發生前決定 preventDefault） */
export function pasteMayContainImage(cd: DataTransfer | null): boolean {
  if (!cd) return false;
  // 有檔案（圖或一般檔）→ 一律攔。9/26：即使同時帶純文字（D 形狀）也攔 — 圖優先
  if ((cd.files?.length || 0) > 0) return true;
  const items = Array.from(cd.items || []);
  if (items.some(i => i.kind === "file")) return true;
  const plain = (cd.getData("text/plain") || "").trim();
  // E/D 形狀：貼的是本 app 截圖 URL → 攔下來轉圖（不再讓它以文字落框）
  if (isShotUrl(plain)) return true;
  // 一般純文字 → 不攔
  if (plain) return false;
  // 無檔案形態：text/html 帶 <img> 且無純文字 → 視為圖片複製
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
  const plain = (cd.getData("text/plain") || "").trim();
  // 3) 純文字是本 app 截圖 URL（D/E 形狀）→ 抓回轉 File（相對路徑補 origin）
  if (isShotUrl(plain)) {
    const url = /^https?:/i.test(plain) ? plain : `${location.origin}${plain}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.type.startsWith("image/")) {
          const ext = blob.type.includes("jpeg") ? "jpg" : blob.type.includes("webp") ? "webp" : blob.type.includes("gif") ? "gif" : "png";
          return [new File([blob], `paste-shot-${Date.now()}.${ext}`, { type: blob.type })];
        }
      }
    } catch { /* fall through */ }
  }
  // 4) 有一般純文字 → 不攔（含一般網址貼上；混合選取想貼文字的行為不變）
  if (plain) return null;
  // 5) text/html 內嵌 data:image → 直接解 base64 轉 File
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
  // 6) text/html 內嵌 http 圖片 URL（例如本機 /api/browser/screenshot）→ 抓回轉 File
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
