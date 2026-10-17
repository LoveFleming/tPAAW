// SSE event extractor
function extractEvents(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || !t.startsWith("data: ")) continue;
    out.push(t.slice(6));
  }
  return out;
}
