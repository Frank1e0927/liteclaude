# s05 Skill Loading 教学规划

> 目标：用 TypeScript 在你当前本地仓库里实现并理解 `s05` 的核心能力，即“技能按需加载”。

---

## 这一章要解决什么问题

到 `s04` 为止，你的 agent 已经具备这些能力：

- 有稳定的 `agent loop`
- 能调用多个工具
- 能维护 todo
- 能启动 subagent

但它还有一个明显问题：

- 如果把所有操作知识、规范、流程都直接塞进 `systemPrompt`，上下文会迅速膨胀
- 很多知识并不是每次任务都需要，提前全部注入很浪费
- 一旦知识多了，prompt 会越来越难维护

`s05` 的解法是：

- 只在 `systemPrompt` 里放“有哪些技能”
- 当模型判断某个技能真的有用时，再调用 `load_skill`
- 把对应 `SKILL.md` 的正文作为 `tool_result` 注入当前对话

一句话概括：

**从“预加载全部知识”切换为“运行时按需加载知识”。**

---

## 我会怎么教你

我不会直接把整章代码甩给你。

我会按下面这个顺序，一步一步带你完成：

1. 先把 `s05` 的机制讲清楚，不急着写代码
2. 再把这个机制映射到你当前 TS 仓库的结构
3. 然后做最小可运行实现
4. 最后用一个真实技能案例验证行为

整个过程会一直围绕你本地这些文件展开：

- [agent.ts](C:/Users/ROG/Desktop/files/agent.ts)
- [agent-loop.ts](C:/Users/ROG/Desktop/files/agent-loop.ts)
- [tools/index.ts](C:/Users/ROG/Desktop/files/tools/index.ts)
- [types.ts](C:/Users/ROG/Desktop/files/types.ts)

必要时我们会新增：

- `skills/`
- `tools/skill.ts`
- `docs/` 下的配套说明

---

## 教学分阶段

### 阶段 1：先理解 s05 的设计

这一阶段不改代码，先把概念讲透。

你会掌握：

- skill 不是 prompt 片段，而是一份可加载知识单元
- `systemPrompt` 里只放技能目录摘要
- 真正正文通过工具返回，而不是预先放进上下文
- skill loading 本质上是“让模型自己决定何时加载额外知识”

验收标准：

- 你能清楚说出为什么不能把所有技能正文都塞进 `systemPrompt`
- 你能区分“技能描述”与“技能正文”

### 阶段 2：先设计 TS 版本的数据结构

这一阶段会先定义我们要实现的最小抽象。

你会学到这些 TypeScript 设计：

- `SkillMeta`
- `LoadedSkill`
- `SkillLoader`
- `listSkillSummaries()`
- `loadSkill(name: string)`

我们会先明确：

- 技能目录怎么组织
- `SKILL.md` 怎么被发现
- 工具返回值用什么字符串格式最稳

验收标准：

- 你能说清 `SkillLoader` 负责什么，不负责什么
- 你能画出“目录扫描 -> 摘要生成 -> 正文加载”的链路

### 阶段 3：实现最小 SkillLoader

这一阶段开始写代码，但先只做本地技能扫描和读取。

计划实现：

- 新建 `skills/` 目录
- 新建一个示例技能目录
- 新建 `tools/skill.ts`
- 实现扫描技能目录
- 实现按名称读取 `SKILL.md`

这一阶段先不接进 agent loop。

验收标准：

- 本地代码能列出技能名
- 能读取指定技能正文
- 对不存在的技能有稳定错误输出

### 阶段 4：把 load_skill 工具接入 Agent

这一阶段把 skill loading 真正接进现有 agent。

计划修改点：

- 在 [agent-loop.ts](C:/Users/ROG/Desktop/files/agent-loop.ts) 增加 `load_skill` handler
- 在工具导出入口注册 skill 工具
- 在 [agent.ts](C:/Users/ROG/Desktop/files/agent.ts) 的 `CONFIG.tools` 中加入 `load_skill`

这里你会重点学到：

- Anthropic tool schema 在 TS 里怎么写
- `tool_use -> handler -> tool_result` 这条链如何承接 skill 正文

验收标准：

- 模型可以调用 `load_skill`
- `tool_result` 中能看到技能正文

### 阶段 5：把技能摘要接进 system prompt

这一阶段会做 `s05` 最关键的一步。

计划修改点：

- 启动时扫描 `skills/`
- 生成简短技能目录摘要
- 把摘要拼接到 `SYSTEM_PROMPT`

这里会强调一个原则：

**摘要进入 prompt，正文不进入 prompt。**

验收标准：

- 启动时 prompt 中包含技能目录
- prompt 不包含整份技能正文

### 阶段 6：做一次完整行为验证

这一阶段不再关注“代码有没有写完”，而关注“模型行为是否符合 `s05` 的意图”。

我们会验证：

1. 模型是否先识别该用哪个 skill
2. 模型是否调用 `load_skill`
3. 模型是否使用返回的 skill 正文继续完成任务
4. 如果不需要 skill，是否不会乱加载

验收标准：

- 至少跑通一个需要技能的案例
- 至少跑通一个不需要技能的案例

---

## 我会特别强调的 5 个坑

### 1. 把 skill 正文直接塞进 `SYSTEM_PROMPT`

这会直接破坏 `s05` 的目的。

### 2. `load_skill` 返回的是你总结后的内容，而不是技能原文

这样模型拿到的就不是标准技能，而是二手摘要，容易失真。

### 3. skill 名称、目录名、工具参数名不一致

这会导致模型会叫得出来，但代码找不到。

### 4. 错误处理不稳定

比如 skill 不存在时返回格式混乱，模型很容易在下一轮误判状态。

### 5. 把 SkillLoader 写成“大杂烩”

它应该主要负责：

- 发现技能
- 提供摘要
- 加载正文

它不应该负责：

- 改 prompt 策略
- 处理 agent loop
- 做工具调度

---

## 我们会产出的代码目标

如果按计划完成，最终你的 TS 项目会新增或改造出这些能力：

- 一个 `skills/` 目录规范
- 一个最小 `SkillLoader`
- 一个 `load_skill` 工具
- 一个可拼接到 `SYSTEM_PROMPT` 的技能摘要生成器
- 一个可以被模型按需调用的技能加载流程

---

## 每一步教学的方式

后面正式开始时，我会按这个固定节奏带你走：

1. 先讲这一步的目标
2. 指出会改哪些 TS 文件
3. 解释为什么改这里
4. 实际修改代码
5. 解释你应该观察到什么结果
6. 再进入下一步

也就是说，后续不会是纯讲理论，而是：

**理解一点，落地一点，验证一点。**

---

## 第一节开始前你需要记住的结论

`s05` 最核心的不是“新增一个工具”，而是建立这套知识流转模型：

- `systemPrompt` 只负责暴露技能入口
- tool 负责把技能正文拉进当前上下文
- 模型根据任务决定是否加载

这个模式后面会直接影响你如何理解：

- 上下文控制
- prompt 分层
- 技能模块化
- 更复杂的多 agent 设计

---

## 接下来我们会怎么开始

正式开始 `s05` 时，我会先带你做第 1 步：

**把当前 TS 仓库中的 `s04` 结构，映射成 `s05` 需要改动的最小位置。**

也就是先回答这三个问题：

1. skill 摘要应该插到哪里
2. `load_skill` 工具应该注册到哪里
3. 技能正文应该通过哪一段消息链注入模型

---

*创建日期：2026-03-16*
