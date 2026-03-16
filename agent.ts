/**
 * s01: Agent 主入口
 *
 * 运行方式：
 *   npm run dev                          # 交互式模式
 *   TASK="列出当前目录" npm run dev      # 单次任务模式
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import * as readline from "readline";
import { agentLoop, BASH_TOOL } from "./agent-loop";
import { TODO_TOOL, TASK_TOOL } from "./tools";
import { AgentConfig, Message } from "./types";

// ─── 配置 ────────────────────────────────────────────────────────────────────

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-5";

/**
 * System Prompt 设计原则（对应原仓库 SYSTEM 变量）：
 * 1. 明确告诉 LLM 它有哪些工具
 * 2. 设定行为边界（只做被要求的事）
 * 3. 规定输出格式
 */
const SYSTEM_PROMPT = `你是一个能在 shell 环境中执行任务的 AI agent。

你有三个工具：
- bash：执行 shell 命令，返回 stdout 和 stderr
- update_todos：维护任务待办列表，跟踪多步任务进度
- task：将子任务派遣给子智能体，子智能体有独立上下文，完成后只返回摘要

注意：当前运行环境是 Windows，请使用 Windows cmd 命令（例如用 dir 而不是 ls，用 type 而不是 cat，用 del 而不是 rm）。

工作原则：
1. 先思考任务，再执行命令
2. 每次只执行一个命令，观察结果后决定下一步
3. 如果命令失败，读取错误信息并调整策略
4. 任务完成后，用简洁的中文总结结果

任务管理规则：
- 接到包含多个步骤的任务时，首先调用 update_todos 列出所有子任务，将第一个设为 in_progress
- 每完成一个子任务，立即调用 update_todos 将其标记为 completed，并将下一个设为 in_progress
- 同时只能有一个任务处于 in_progress 状态
- 所有任务完成后，将列表全部标记为 completed

子智能体使用原则：
- 当用户的任务包含 2 个及以上独立子任务时，必须用 task 工具将每个子任务派遣给子智能体
- 当任务需要读取多个文件但只需要摘要时，用 task 派遣子智能体
- 不要自己用 bash 完成所有事情，优先考虑用 task 拆分任务
- 子智能体不能再派遣子智能体（只有一层深度）

安全限制：
- 不执行破坏性命令（del /f /s、format 等）
- 不访问敏感系统文件
- 不进行网络请求（除非用户明确要求）`;

const CONFIG: AgentConfig = {
  model: MODEL,
  maxTokens: 4096,
  systemPrompt: SYSTEM_PROMPT,
  tools: [BASH_TOOL, TODO_TOOL, TASK_TOOL],
  maxIterations: 50,
  debug: process.env.DEBUG === "1",
};

// ─── 单次任务模式 ─────────────────────────────────────────────────────────────

async function runTask(task: string): Promise<void> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  });

  // 初始消息：用户任务
  // Python: messages = [{"role": "user", "content": task}]
  const messages: Message[] = [{ role: "user", content: task }];

  console.log("\n" + "═".repeat(60));
  console.log(`任务: ${task}`);
  console.log("═".repeat(60));

  const startTime = Date.now();

  const result = await agentLoop(client, CONFIG, messages);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "═".repeat(60));
  console.log("✓ 任务完成");
  console.log(`  迭代次数: ${result.iterations}`);
  console.log(`  耗时: ${elapsed}s`);
  console.log("─".repeat(60));
  console.log(result.finalText);
  console.log("═".repeat(60) + "\n");
}

// ─── 交互式 REPL 模式 ─────────────────────────────────────────────────────────

async function runRepl(): Promise<void> {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\n你 > ",
  });

  console.log("═".repeat(60));
  console.log("  s01 Agent Loop — 交互模式");
  console.log("  输入任务，按 Enter 执行；输入 'exit' 退出");
  console.log("═".repeat(60));

  rl.prompt();

  rl.on("line", async (line) => {
    const task = line.trim();
    if (!task) { rl.prompt(); return; }
    if (task === "exit" || task === "quit") {
      console.log("再见！");
      rl.close();
      return;
    }

    // 注意：每次任务都是全新的 messages[]
    // 这是 s01 的核心特征：无状态，每次任务独立
    // s09 开始才引入持久化的 Agent 记忆
    const messages: Message[] = [{ role: "user", content: task }];

    try {
      const result = await agentLoop(client, CONFIG, messages);
      console.log("\nAgent > " + result.finalText);
    } catch (err) {
      console.error("[error]", err);
    }

    rl.prompt();
  });

  rl.on("close", () => process.exit(0));
}

// ─── 入口 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 检查 API Key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("错误：请设置 ANTHROPIC_API_KEY 环境变量");
    console.error("  cp .env.example .env && 编辑 .env 填入你的 key");
    process.exit(1);
  }

  // 单次任务模式（通过 TASK 环境变量或命令行参数）
  const task = process.env.TASK ?? process.argv[2];
  if (task) {
    await runTask(task);
  } else {
    // 默认进入交互式 REPL
    await runRepl();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
