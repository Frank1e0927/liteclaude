/**
 * s01 Demo — 三个渐进示例，演示 agent loop 的完整行为
 *
 * 运行：npm run demo
 *
 * 示例设计：
 *   Demo 1 — 单步任务（LLM 调用一次工具后结束）
 *   Demo 2 — 多步任务（LLM 连续调用多次工具）
 *   Demo 3 — 错误恢复（命令失败，LLM 自动调整策略）
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { agentLoop, BASH_TOOL } from "./agent-loop";
import { AgentConfig, Message } from "./types";


// ─── 配置（debug=true 可看到每次迭代的详细日志） ──────────────────────────────

const client = new Anthropic();

const CONFIG: AgentConfig = {
  model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-5",
  maxTokens: 2048,
  systemPrompt: `你是一个能执行 bash 命令的 AI agent。
用中文回复，保持简洁。
每次思考下一步前先确认当前步骤的结果。`,
  tools: [BASH_TOOL],
  maxIterations: 20,
  debug: false,  // 改为 true 可看详细循环日志
};

// ─── 辅助打印 ─────────────────────────────────────────────────────────────────

function header(title: string): void {
  console.log("\n" + "═".repeat(60));
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function footer(result: Awaited<ReturnType<typeof agentLoop>>): void {
  console.log("\n── 结果 " + "─".repeat(52));
  console.log(result.finalText);
  console.log(`\n[迭代 ${result.iterations} 次 | ${result.messages.length} 条消息]`);
}

// ─── Demo 1：单步任务（agent 调用一次工具就结束） ──────────────────────────────

async function demo1(): Promise<void> {
  header("Demo 1 — 单步任务：查看当前目录");

  // 消息数变化：
  //   开始: [{role:"user", content:"..."}]          → 1 条
  //   迭代1: LLM 调用 bash(ls -la)                 → push assistant → 2 条
  //   迭代1: 执行 bash，拿到结果                    → push user(tool_result) → 3 条
  //   迭代2: LLM stop_reason="end_turn"             → push assistant → 4 条，返回

  const messages: Message[] = [
    { role: "user", content: "列出当前目录的文件，并告诉我共有多少个文件" },
  ];

  const result = await agentLoop(client, CONFIG, messages);
  footer(result);
}

// ─── Demo 2：多步任务（agent 连续执行多个工具调用） ───────────────────────────

async function demo2(): Promise<void> {
  header("Demo 2 — 多步任务：创建文件并验证");

  // 预期 agent 的行为序列：
  //   步骤1: bash("mkdir -p /tmp/agent-demo && echo 'hello' > /tmp/agent-demo/test.txt")
  //   步骤2: bash("cat /tmp/agent-demo/test.txt")
  //   步骤3: bash("wc -l /tmp/agent-demo/test.txt")
  //   最终: 返回文字总结

  const messages: Message[] = [
    {
      role: "user",
      content: [
        "完成以下任务，每步都告诉我结果：",
        "1. 在 /tmp/agent-demo 目录下创建 test.txt，内容是当前日期",
        "2. 读取并显示文件内容",
        "3. 报告文件大小（字节数）",
      ].join("\n"),
    },
  ];

  const result = await agentLoop(client, CONFIG, messages);
  footer(result);
}

// ─── Demo 3：错误恢复（agent 遇到错误后自动调整策略） ────────────────────────

async function demo3(): Promise<void> {
  header("Demo 3 — 错误恢复：读取不存在的文件");

  // 预期 agent 的行为序列：
  //   步骤1: bash("cat /tmp/nonexistent-file.txt") → 报错
  //   步骤2: 观察到错误，改为 bash("ls /tmp/ | grep nonexistent") → 无结果
  //   步骤3: agent 总结"文件不存在"并给出建议

  // 这个 demo 展示了 agent loop 的核心价值：
  //   LLM 看到工具返回的错误信息，能自主决定下一步怎么做，
  //   而不需要程序员手写 if/else 错误处理逻辑

  const messages: Message[] = [
    {
      role: "user",
      content: "读取 /tmp/nonexistent-file-12345.txt 的内容，如果文件不存在，告诉我并给出解决方案",
    },
  ];

  const result = await agentLoop(client, CONFIG, messages);
  footer(result);
}

// ─── 解析 agent loop 的消息历史（教学用） ────────────────────────────────────

async function demoInspect(): Promise<void> {
  header("Demo 4 — 观察消息历史结构");

  const messages: Message[] = [
    { role: "user", content: "用一条命令打印 Node.js 版本" },
  ];

  console.log("\n初始 messages:", JSON.stringify(messages, null, 2));

  const result = await agentLoop(client, CONFIG, messages);

  console.log("\n\n完整 messages 历史:");
  result.messages.forEach((msg, i) => {
    const content = Array.isArray(msg.content)
      ? msg.content.map((b: any) => {
          if (b.type === "text") return `[text] ${b.text.slice(0, 60)}…`;
          if (b.type === "tool_use") return `[tool_use] ${b.name}(${JSON.stringify(b.input)})`;
          if (b.type === "tool_result") return `[tool_result] ${String(b.content).slice(0, 60)}…`;
          return `[${b.type}]`;
        })
      : [msg.content];

    console.log(`\n[${i}] role: ${msg.role}`);
    content.forEach((c) => console.log(`    ${c}`));
  });
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("错误：请先设置 ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const demoNum = process.argv[2];

  if (demoNum === "1") { await demo1(); return; }
  if (demoNum === "2") { await demo2(); return; }
  if (demoNum === "3") { await demo3(); return; }
  if (demoNum === "4") { await demoInspect(); return; }

  // 默认运行全部
  await demo1();
  await demo2();
  await demo3();
  await demoInspect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
