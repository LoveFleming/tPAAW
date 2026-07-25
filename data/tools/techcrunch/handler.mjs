/**
 * TechCrunch RSS Fetcher — 抓取當日最新新聞
 * 回傳 JSON: { articles: [{ title, link, pubDate, description }], count, date }
 */

export default async function handler(args, ctx) {
  const limit = args.limit || 10;
  const today = new Date().toISOString().split("T")[0];

  try {
    const resp = await fetch("https://techcrunch.com/feed/", {
      headers: { "User-Agent": "PAAW/1.0" },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      return { text: `❌ TechCrunch RSS 失敗: HTTP ${resp.status}`, error: true };
    }

    const xml = await resp.text();

    // 簡易 RSS XML 解析（不依賴外部套件）
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
      const block = match[1];

      const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/s)?.[1]
                 || block.match(/<title>(.*?)<\/title>/s)?.[1]
                 || "";

      const link = block.match(/<link>(.*?)<\/link>/s)?.[1]?.trim() || "";

      const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/s)?.[1]?.trim() || "";

      // 去掉 HTML tag 的 description
      const rawDesc = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/s)?.[1]
                   || block.match(/<description>([\s\S]*?)<\/description>/s)?.[1]
                   || "";
      const description = rawDesc.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300);

      if (title) {
        items.push({ title, link, pubDate, description });
      }
    }

    const summary = `✅ 抓取 TechCrunch ${items.length} 篇文章（${today}）`;
    return {
      text: summary,
      data: { articles: items, count: items.length, date: today },
    };
  } catch (err) {
    return { text: `❌ TechCrunch fetch 失敗: ${err.message}`, error: true };
  }
}
