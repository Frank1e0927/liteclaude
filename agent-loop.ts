/**
 * s01: The Agent Loop
 * ─────────────────────────────────────────────────────────────────
 * "One loop & Bash is all you need"
 *
 * 这是整个课程的内核。从 s02 到 s12，每一节都在这个循环上叠加机制，
 * 但循环本身的结构从不改变。
 *
 *                    THE AGENT PATTERN
 *                    =================
 *
 *  User --> messages[] --> LLM --> response
 *                                    |
 *                        stop_reason === "tool_use"?
 *                       /                           \
 *                     yes                            no
 *                      |                              |
 *               execute tools                     return text
 *               append results
 *               loop back ──────────────────> messages[]
 */

import Anthropic from "@anthropic-ai/sdk";
import { AgentConfig, AgentResult, Message, TodoItem, ToolResult } from "./types";
import { bashTool, loadSkill, TodoManager, runSubagent } from "./tools";

// ─── Anthropic Tool 定义（JSON Schema） ─────────────────────────────────────

export const BASH_TOOL: Anthropic.Tool = {
  name: "bash",
  description: [
    "在 bash shell 中执行命令，返回 stdout + stderr。",
    "支持：文件操作、目录遍历、运行脚本、系统信息查询等。",
    "超时时间：30 秒。",
    "注意：命令在同步环境中运行，避免需要交互式输入的命令。",
  ].join("\n"),
  input_schema: {
    type: "object" as const,
    properties: {
      command: {
        type: "string",
        description: "要执行的 bash 命令",
      },
    },
    required: ["command"],
  },
};

// ─── 核心 Agent Loop ─────────────────────────────────────────────────────────

/**
 * agentLoop — s01 的核心，等价于原仓库 Python 版的 agent_loop()
 *
 * Python 版（同步）:
 *   def agent_loop(messages):
 *       while True:
 *           response = client.messages.create(...)
 *           if response.stop_reason != "tool_use":
 *               return
 *           ...execute tools...
 *
 * JS 版（async/await）:
 *   - 每次 LLM 调用都是 await，其余逻辑完全对应
 *   - TypeScript 类型让 ToolUseBlock 的取用更安全
 */
export async function agentLoop(
  client: Anthropic,
  config: AgentConfig,
  messages: Message[]
): Promise<AgentResult> {
  const maxIter = config.maxIterations ?? 50;
  let iteration = 0;

  // ─── TodoManager 状态（函数级，跨迭代共享） ────────────────────────────────
  const todoManager = new TodoManager();
  let roundsSinceTodo = 0;

  // s04: handler 改为 async，因为 task 工具需要 await 子智能体
  type ToolHandler = (input: Record<string, unknown>) => string | Promise<string>;
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
    // s04 新增：task 工具 → 派遣子智能体
    task: (input) => runSubagent(client, config, input.prompt as string),
    load_skill: (input) => {
      try {
        return loadSkill(input.name as string);
      } catch (e) {
        return `[错误] ${(e as Error).message}`;
      }
    },
  };

  while (iteration < maxIter) {
    iteration++;

    if (config.debug) {
      console.log(`\n${"─".repeat(60)}`);
      console.log(`[loop] 第 ${iteration} 次迭代，消息数: ${messages.length}`);
    }

    // ① 调用 LLM ───────────────────────────────────────────────────────────
    //
    // Python: response = client.messages.create(model=..., messages=..., ...)
    // JS:     const response = await client.messages.create({...})
    //
    // 关键：JS SDK 的 create() 返回 Promise，必须 await

    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      tools: config.tools,
      messages: messages as Anthropic.MessageParam[],
    });

    if (config.debug) {
      console.log(`[loop] stop_reason: ${response.stop_reason}`);
      console.log(
        `[loop] 本次 usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens}`
      );
    }

    // ② 把 assistant 回复追加到消息历史 ─────────────────────────────────────
    //
    // Python: messages.append({"role":"assistant","content":response.content})
    // JS:     messages.push({ role: "assistant", content: response.content })

    messages.push({
      role: "assistant",
      content: response.content,
    });

    // ③ 检查停止条件 ──────────────────────────────────────────────────────────
    //
    // stop_reason 的所有可能值：
    //   "end_turn"    → LLM 认为任务完成，返回最终文本
    //   "tool_use"    → LLM 要调用工具，需要我们执行并回传结果
    //   "max_tokens"  → 达到 max_tokens 上限
    //   "stop_sequence" → 遇到停止序列

    if (response.stop_reason !== "tool_use") {
      // 任务完成，提取最终文本
      const finalText = extractFinalText(response.content);
      return { finalText, iterations: iteration, messages };
    }

    // ④ 执行所有工具调用 ──────────────────────────────────────────────────────
    //
    // Python 版：
    //   for block in response.content:
    //       if block.type == "tool_use":
    //           output = TOOL_HANDLERS[block.name](**block.input)
    //
    // JS 版：filter + map，TypeScript 类型守卫确保安全

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    // s04: 所有工具调用并行执行（子智能体之间互不依赖，可以同时跑）
    const toolResults: ToolResult[] = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const handler = TOOL_HANDLERS[block.name];

        if (!handler) {
          console.warn(`[warn] 未知工具: ${block.name}`);
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: `错误：未知工具 "${block.name}"`,
          };
        }

        console.log(`\n[tool] ${block.name}`);
        console.log(`[cmd]  ${JSON.stringify(block.input)}`);

        const startTime = Date.now();
        const output = await Promise.resolve(handler(block.input as Record<string, unknown>));
        const elapsed = Date.now() - startTime;

        console.log(`[out]  ${output.slice(0, 200)}${output.length > 200 ? "…" : ""}`);
        console.log(`[time] ${elapsed}ms`);

        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: output,
        };
      })
    );

    // ⑤ 把工具结果追加到消息历史，进入下一次循环 ─────────────────────────────
    //
    // Python: messages.append({"role":"user","content":results})
    // JS:     messages.push({ role: "user", content: toolResults })
    //
    // 注意：工具结果的 role 是 "user"，不是 "tool"

    messages.push({
      role: "user",
      content: toolResults as unknown as Anthropic.ContentBlock[],
    });

    // ⑥ nag reminder：若连续 3 轮未调用 update_todos，注入提醒 ───────────────
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
  }

  // 超过最大迭代次数
  console.warn(`[warn] 已达最大迭代次数 ${maxIter}`);
  return {
    finalText: "(达到最大迭代次数，任务可能未完成)",
    iterations: maxIter,
    messages,
  };
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

/**
 * 从 response.content 中提取纯文本（最后一条 TextBlock）
 */
function extractFinalText(content: Anthropic.ContentBlock[]): string {
  const texts = content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text);
  return texts.join("\n").trim();
}
