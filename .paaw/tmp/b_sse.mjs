// ── SSE frame parser: re-implements the reader loop in ChatView.handleSend ──
function makeSSEParser() {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      return lines;
    },
    flush() {
      if (!buffer) return [];
      const rest = [buffer];
      buffer = "";
      return rest;
    },
  };
}
