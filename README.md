# s01 — Agent 循环核心（Node.js/TypeScript 版）

> "One loop & Bash is all you need"

原仓库 [learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) 的 Python 版 `agents/s01_agent_loop.py` 的完整 TypeScript 对照实现。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY

# 3. 运行演示（4 个渐进示例）
npm run demo

# 4. 运行单个演示
npx ts-node src/demo.ts 1    # 单步任务
npx ts-node src/demo.ts 2    # 多步任务
npx ts-node src/demo.ts 3    # 错误恢复
npx ts-node src/demo.ts 4    # 观察消息历史结构

# 5. 交互模式
npm run dev

# 6. 单次任务
TASK="统计当前目录下的 .ts 文件数量" npm run dev
```

## 项目结构

```
src/
  types.ts        — 类型定义（Message, AgentConfig, ToolResult...）
  tools.ts        — bash 工具实现（execSync + 错误处理 + 截断）
  agent-loop.ts   — 核心 agentLoop() 函数 + TOOL_HANDLERS + BASH_TOOL 定义
  agent.ts        — 主入口（单次任务模式 + 交互式 REPL 模式）
  demo.ts         — 4 个渐进式演示
```

## Python → TypeScript 核心对照

### 1. 同步 vs 异步

```python
# Python（同步）
response = client.messages.create(model=..., messages=...)
```

```typescript
// TypeScript（必须 async/await）
const response = await client.messages.create({ model: ..., messages });
```

### 2. 工具分发表

```python
# Python
TOOL_HANDLERS = { "bash": bash_tool }
output = TOOL_HANDLERS[block.name](**block.input)
```

```typescript
// TypeScript（类型安全版）
type ToolHandler = (input: Record<string, unknown>) => string;
const TOOL_HANDLERS: Record<string, ToolHandler> = {
  bash: (input) => bashTool(input.command as string),
};
const output = TOOL_HANDLERS[block.name](block.input);
```

### 3. 类型守卫提取 ToolUseBlock

```python
# Python
for block in response.content:
    if block.type == "tool_use":
        ...
```

```typescript
// TypeScript（类型守卫，比 Python 更安全）
const toolBlocks = response.content.filter(
  (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
);
```

### 4. subprocess.run → execSync

```python
# Python
result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
return result.stdout + result.stderr
```

```typescript
// TypeScript
import { execSync } from "child_process";
try {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", shell: "/bin/bash" });
} catch (err: any) {
  return (err.stdout ?? "") + (err.stderr ?? "");
}
```

## 核心循环图示

```
                    消息历史（messages[]）的变化过程
                    ================================

  初始:  [user: "任务描述"]

  迭代1: [user: "任务描述"]
         [assistant: [ToolUseBlock{name:"bash", input:{command:"ls"}}]]
         [user: [ToolResultBlock{content:"file1.txt\nfile2.txt"}]]

  迭代2: ...（如果还需要工具）...

  结束:  [user: "任务描述"]
         ...
         [assistant: [TextBlock{text:"这是最终答案"}]]
                      ↑
             stop_reason = "end_turn"，退出循环
```

## stop_reason 完整说明

| stop_reason       | 含义                      | agentLoop 的处理          |
|-------------------|---------------------------|---------------------------|
| `"end_turn"`      | LLM 认为任务完成          | ✅ 返回最终文本            |
| `"tool_use"`      | LLM 要调用工具            | 🔄 执行工具，继续循环      |
| `"max_tokens"`    | 达到 max_tokens 上限      | ✅ 返回当前文本（可能不完整）|
| `"stop_sequence"` | 遇到停止序列              | ✅ 返回当前文本            |

## 练习任务

完成以下练习来加深理解：

1. **基础**：修改 `SYSTEM_PROMPT`，让 agent 只回复英文，观察行为变化
2. **工具扩展**：在 `TOOL_HANDLERS` 里添加第二个工具（比如 `read_file`），这就是 s02 的准备
3. **迭代观察**：在 `agentLoop` 里打开 `debug: true`，观察每次迭代的 token 消耗
4. **上限测试**：把 `maxIterations` 改为 2，给 agent 一个需要 3 步的任务，看看会发生什么
5. **错误注入**：在 `bashTool` 里故意让某个命令失败，看 agent 如何恢复

## 到 s02 需要做什么

s01 → s02 的唯一变化是把 `TOOL_HANDLERS` 从一个工具扩展为多个：

```typescript
// s01
const TOOL_HANDLERS = { bash: ... };

// s02（扩展后）
const TOOL_HANDLERS = {
  bash: ...,
  read_file: ...,
  write_file: ...,
  list_files: ...,
};
```

**循环本身一行代码都不用改。** 这就是 s02 那句话的含义：
> "Adding a tool means adding one handler"
