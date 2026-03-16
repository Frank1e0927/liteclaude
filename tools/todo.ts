import Anthropic from "@anthropic-ai/sdk";
import { TodoItem } from "../types";

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
  description: [
    "更新任务待办列表，跟踪多步任务的执行进度。",
    "在开始复杂任务时，先调用此工具列出所有子任务；",
    "每完成一步，将其状态改为 completed，并将下一步设为 in_progress。",
    "规则：同时只能有一个任务处于 in_progress 状态。",
  ].join("\n"),
  input_schema: {
    type: "object" as const,
    properties: {
      todos: {
        type: "array",
        description: "完整的待办列表（每次传入全量，不是增量）",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "任务唯一标识，如 '1'、'2'" },
            text: { type: "string", description: "任务描述" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "任务状态",
            },
          },
          required: ["id", "text", "status"],
        },
      },
    },
    required: ["todos"],
  },
};
