# s03 TodoManager 实现记录

> 写给下一个 Claude 会话：本文档记录了在 s01 Agent Loop 项目中添加 TodoManager（s03 TodoWrite）的完整过程，方便新会话直接接续工作。

---

## 项目背景

- **项目名**：`s01-agent-loop`，路径：`C:\Users\ROG\Desktop\files`
- **技术栈**：TypeScript + Node.js + `@anthropic-ai/sdk`，用 `ts-node` 直接运行
- **运行环境**：Windows 11，shell 用 cmd.exe
- **启动命令**：`npm run dev`（交互式 REPL）或 `TASK="任务" npm run dev`（单次任务）
- **API 配置**：`.env` 文件中存放 `ANTHROPIC_API_KEY`，模型默认 `claude-opus-4-5`

---

## 本次改动目标

原 s01 只有一个 `bash` 工具。多步任务中 AI 容易丢失进度。
本次参考 s03 文档，添加 **TodoManager**，让 AI 维护一份带状态的待办清单，并通过 **nag reminder** 机制防止 AI 忘记更新进度。

---

## 文件结构（改动后）

```
files/
├── agent.ts          ← 主入口，CONFIG + SYSTEM_PROMPT
├── agent-loop.ts     ← 核心 Agent Loop
├── todo.ts           ← 新建：TodoManager 类 + TODO_TOOL 定义
├── tools.ts          ← bash 工具实现（未改动）
├── types.ts          ← 类型定义
├── demo.ts           ← 示例（未改动）
└── docs/
    └── s03-todo-manager.md   ← 本文档
```

---

## 各文件改动详情

### 1. `types.ts` — 追加 3 个类型

在文件末尾追加：

```typescript
export type TodoStatus = "pending" | "in_progress" | "completed";
export interface TodoItem { id: string; text: string; status: TodoStatus; }
export interface TodoInput { todos: TodoItem[]; }
```

### 2. `todo.ts` — 新建文件（完整内容）

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { TodoItem } from "./types";

const VALID_STATUSES = new Set(["pending", "in_progress", "completed"]);

const STATUS_ICON: Record<string, string> = {
  completed: "[✓]",
  in_progress: "[→]",
  pending: "[ ]",
};

export class TodoManager {
  private todos: TodoItem[] = [];

  update(todos: TodoItem[]): string {
    // 验证状态合法性
    for (const item of todos) {
      if (!VALID_STATUSES.has(item.status)) {
        return `[错误] 非法状态 "${item.status}"，合法值：pending | in_progress | completed`;
      }
    }
    // 强制只有一个 in_progress
    const inProgress = todos.filter((t) => t.status === "in_progress");
    if (inProgress.length > 1) {
      return `[错误] 同时只能有一个任务处于 in_progress 状态，当前有 ${inProgress.length} 个`;
    }
    this.todos = todos;
    return this.render();
  }

  render(): string {
    if (this.todos.length === 0) return "(待办列表为空)";
    return this.todos
      .map((t) => `${STATUS_ICON[t.status] ?? "[ ]"} ${t.text}`)
      .join("\n");
  }
}

export const TODO_TOOL: Anthropic.Tool = {
  name: "update_todos",
  description: "更新任务待办列表，跟踪多步任务的执行进度。...",
  input_schema: {
    type: "object" as const,
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["id", "text", "status"],
        },
      },
    },
    required: ["todos"],
  },
};
```

### 3. `agent-loop.ts` — 3 处修改

**① import 行**（顶部）：
```typescript
import { AgentConfig, AgentResult, Message, TodoItem, ToolResult } from "./types";
import { TodoManager } from "./todo";
```

**② TOOL_HANDLERS 移入 agentLoop 函数体**（紧跟函数开头 maxIter/iteration 声明后）：
```typescript
const todoManager = new TodoManager();
let roundsSinceTodo = 0;

type ToolHandler = (input: Record<string, unknown>) => string;
const TOOL_HANDLERS: Record<string, ToolHandler> = {
  bash: (input) => bashTool(input.command as string),
  update_todos: (input) => {
    try {
      const result = todoManager.update(input.todos as TodoItem[]);
      roundsSinceTodo = 0;
      return result;
    } catch (e) {
      return `[错误] ${(e as Error).message}`;
    }
  },
};
```

**③ nag reminder**（在 `messages.push(toolResults)` 之后）：
```typescript
roundsSinceTodo++;
if (roundsSinceTodo >= 3) {
  const lastMsg = messages[messages.length - 1];
  if (Array.isArray(lastMsg.content)) {
    (lastMsg.content as Array<unknown>).unshift({
      type: "text",
      text: "<reminder>请更新你的待办列表（update_todos），标记已完成的任务，将下一个任务设为 in_progress。</reminder>",
    });
  }
}
```

### 4. `agent.ts` — 2 处修改

**① import**：
```typescript
import { TODO_TOOL } from "./todo";
```

**② CONFIG.tools**：
```typescript
tools: [BASH_TOOL, TODO_TOOL],
```

**③ SYSTEM_PROMPT 新增段落**：
```
任务管理规则：
- 接到包含多个步骤的任务时，首先调用 update_todos 列出所有子任务，将第一个设为 in_progress
- 每完成一个子任务，立即调用 update_todos 将其标记为 completed，并将下一个设为 in_progress
- 同时只能有一个任务处于 in_progress 状态
- 所有任务完成后，将列表全部标记为 completed
```

---

## 核心设计要点

| 要点 | 说明 |
|------|------|
| `TOOL_HANDLERS` 在函数体内 | 因为需要访问函数级变量 `todoManager` 和 `roundsSinceTodo` |
| `update()` 不抛异常 | 返回错误字符串，避免中断 agent 循环 |
| nag reminder 插在 content 数组最前面 | 用 `unshift` 确保 LLM 先看到提醒 |
| `roundsSinceTodo` 在 `update_todos` 被调用时重置为 0 | 计数器只在 bash 轮次中递增 |

---

## 验证方式

启动后输入多步任务：
```
帮我在桌面创建3个文件：a.txt、b.txt、c.txt，分别写入不同内容
```

预期行为：
1. AI 第一步调用 `update_todos` 列出 3 个子任务
2. 每完成一个文件，更新对应状态为 `completed`，下一个设为 `in_progress`
3. 若连续 3 轮未调用 `update_todos`，控制台可见 reminder 被注入

---

## 后续可做的方向（s04+）

- **s04**：多工具支持（文件读写工具等）
- **s09**：持久化 Agent 记忆（跨任务记住上下文）
- **s08**：真正的异步工具执行

---

*生成时间：2026-03-15，由 Claude Sonnet 4.6 生成*
