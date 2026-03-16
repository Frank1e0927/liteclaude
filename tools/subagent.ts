/**
 * s04: 子智能体（Subagent）
 * ─────────────────────────────────────────────────────────────────
 * "大任务拆小, 每个小任务干净的上下文"
 *
 * 核心思想：
 *   父 Agent 通过 task 工具把子任务委派给一个拥有独立 messages[] 的子 Agent。
 *   子 Agent 跑完后，只把最终文本（摘要）返回给父 Agent。
 *   子 Agent 的所有中间 messages 被丢弃，不会污染父 Agent 的上下文。
 *
 *   类比：你是经理（父 Agent），派下属（子 Agent）去查资料，
 *         下属查完跟你说一句结论，你的桌面（context）始终干净。
 *
 * 与 Python 原版对应：
 *   agents/s04_subagent.py → run_subagent()
 */

import Anthropic from "@anthropic-ai/sdk";
import { AgentConfig, Message } from "../types";
import { agentLoop } from "../agent-loop";

// ─── task 工具定义（JSON Schema） ────────────────────────────────────────────

export const TASK_TOOL: Anthropic.Tool = {
  name: "task",
  description: [
    "将一个子任务派遣给子智能体执行。",
    "子智能体拥有独立的上下文（不会污染当前对话），可以使用 bash 和 update_todos 工具。",
    "适用场景：需要读取大量文件但只需要一个摘要、需要执行多步操作但只关心最终结果。",
    "子智能体完成后只返回最终的文本摘要。",
  ].join("\n"),
  input_schema: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string",
        description: "交给子智能体的任务描述，要清晰具体",
      },
    },
    required: ["prompt"],
  },
};

// ─── 子智能体运行函数 ────────────────────────────────────────────────────────

/**
 * runSubagent — 在独立的 messages[] 中运行一个子智能体
 *
 * 关键设计：
 *   1. 子 Agent 的 messages 从空数组开始（干净的上下文）
 *   2. 子 Agent 只有基础工具（bash、update_todos），没有 task（防递归）
 *   3. 子 Agent 跑完后，只返回最终文本给父 Agent
 *   4. 子 Agent 的所有中间 messages 被丢弃
 *
 * Python 原版对应：
 *   def run_subagent(prompt):
 *       messages = [{"role": "user", "content": prompt}]
 *       return agent_loop(messages)  # 用 child tools, 没有 task
 */
const MAX_SUBAGENT_OUTPUT = 50_000;

export async function runSubagent(
  client: Anthropic,
  parentConfig: AgentConfig,
  prompt: string
): Promise<string> {
  console.log(`\n${"─".repeat(40)}`);
  console.log(`[subagent] 启动子智能体`);
  console.log(`[subagent] 任务: ${prompt.slice(0, 100)}${prompt.length > 100 ? "…" : ""}`);
  console.log(`${"─".repeat(40)}`);

  // ① 子 Agent 的工具集：排除 task 工具，防止无限递归
  const childTools = parentConfig.tools.filter((t) => t.name !== "task");

  // ② 子 Agent 的配置：继承父 Agent 的大部分配置，但限制迭代次数
  const childConfig: AgentConfig = {
    ...parentConfig,
    tools: childTools,
    maxIterations: 30, // 子任务不应太长
    systemPrompt:
      parentConfig.systemPrompt +
      "\n\n你是一个子智能体，被父智能体派来执行特定子任务。" +
      "完成后请用简洁的文字总结结果，只报告关键信息。",
  };

  // ③ 关键：全新的 messages[]，这就是"干净的上下文"
  const childMessages: Message[] = [{ role: "user", content: prompt }];

  // ④ 复用同一个 agentLoop，但用子 Agent 的配置
  const result = await agentLoop(client, childConfig, childMessages);

  console.log(`\n[subagent] 子智能体完成，迭代 ${result.iterations} 次`);
  console.log(`${"─".repeat(40)}\n`);

  // ⑤ 只返回最终文本，中间过程的 messages 全部丢弃
  const output = result.finalText || "(子智能体未返回结果)";

  // 截断过长的输出
  if (output.length > MAX_SUBAGENT_OUTPUT) {
    return output.slice(0, MAX_SUBAGENT_OUTPUT) + "\n...(输出已截断)";
  }
  return output;
}
