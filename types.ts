import Anthropic from "@anthropic-ai/sdk";

// ─── 消息类型 ────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant";

export interface Message {
  role: MessageRole;
  content: string | Anthropic.ContentBlock[];
}

// ─── 工具结果 ────────────────────────────────────────────────────────────────

export interface ToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// ─── bash 工具的输入 schema ───────────────────────────────────────────────────

export interface BashInput {
  command: string;
}

// ─── Agent 配置 ──────────────────────────────────────────────────────────────

export interface AgentConfig {
  model: string;
  maxTokens: number;
  systemPrompt: string;
  tools: Anthropic.Tool[];
  /** 最大循环次数（防无限循环，默认 50） */
  maxIterations?: number;
  /** 是否打印详细调试信息 */
  debug?: boolean;
}

// ─── Agent 运行结果 ──────────────────────────────────────────────────────────

export interface AgentResult {
  finalText: string;
  iterations: number;
  messages: Message[];
}

// ─── TodoManager 类型 ────────────────────────────────────────────────────────

export type TodoStatus = "pending" | "in_progress" | "completed";
export interface TodoItem { id: string; text: string; status: TodoStatus; }
export interface TodoInput { todos: TodoItem[]; }

// s05: skill loading
export interface SkillMeta {
  name: string;
  description: string;
  dirPath: string;
  skillFilePath: string;
}

export interface LoadedSkill extends SkillMeta {
  content: string;
}
