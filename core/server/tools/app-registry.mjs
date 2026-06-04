// tClaw App Registry — predefined app prompts
// Each app defines: id, name, icon, description, prompt (how AI should operate it)
// The system prompt injects relevant app instructions based on context

const appRegistry = [
  {
    id: "todo",
    name: "待辦事項",
    icon: "📋",
    description: "管理待辦事項：新增、查看、完成、刪除",
    prompt: `## 待辦事項 App 操作指南
可用工具：todo_add, todo_list, todo_update, todo_delete
- 新增時確認內容、優先級、截止日期
- 列出時用清晰的格式呈現（✅ 已完成 / 🟡 進行中 / 🔴 高優先）
- 使用者說「完成了」→ 更新狀態為 done
- 使用者說「刪掉那個」→ 確認後刪除
- 主動提醒：如果截止日期快到了，提醒使用者`
  },
  {
    id: "notes",
    name: "筆記",
    icon: "📝",
    description: "建立和管理筆記",
    prompt: `## 筆記 App 操作指南
可用工具：note_create, note_list, note_read, note_delete
- 使用者說「記一下」「寫個筆記」→ 建立筆記
- 自動整理標題和內容
- 支援標籤分類
- 使用者說「我之前記過...」→ 搜尋筆記`
  },
  {
    id: "files",
    name: "檔案瀏覽",
    icon: "📁",
    description: "查看工作區檔案",
    prompt: `## 檔案瀏覽 App 操作指南
可用工具：file_list, file_read
- 只能讀取，不能寫入或刪除（安全考量）
- 列出目錄時用圖示區分檔案類型
- 讀檔案時自動截斷過長內容
- 使用者問程式相關問題 → 先看檔案再回答`
  },
  {
    id: "memory",
    name: "記憶",
    icon: "🧠",
    description: "長期記憶管理",
    prompt: `## 記憶系統 操作指南
可用工具：memory_save, memory_read
- 使用者說「記住」「幫我記」→ 存到記憶
- 記憶是跨對話的，每次對話都會載入
- 記憶內容要精簡、有結構
- 重要決策、偏好、人際關係都值得記
- 不確定的事先確認再記
- 定期整理記憶，移除過時的`
  },
  {
    id: "cron",
    name: "定時任務",
    icon: "⏰",
    description: "設定提醒和定時任務（預留）",
    prompt: `## 定時任務 App 操作指南（預留）
- 未來會支援設定提醒、定時執行
- 例如「每天早上 9 點提醒我看 todo」
- 例如「下週三提醒我開會」
- 目前可先記錄需求，等功能上線後設定`
  },
  {
    id: "workspace",
    name: "工作區",
    icon: "🗂️",
    description: "管理多個工作區目錄",
    prompt: `## 工作區 App 操作指南
- 使用者可以有多個工作區（專案目錄）
- 讀取檔案時確認是哪個工作區
- 預設使用第一個工作區`
  }
];

export { appRegistry };

// Build the app instructions section for system prompt
export function buildAppInstructions() {
  return appRegistry.map(app =>
    `### ${app.icon} ${app.name}\n${app.prompt}`
  ).join("\n\n");
}
