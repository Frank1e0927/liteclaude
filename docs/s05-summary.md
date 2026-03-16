# s05 阶段性总结

> 本文档用于总结当前这套 TypeScript 版本 `s05 skill loading` 的学习结果、代码落地情况、测试结论，以及后续待优化问题。

---

## 这一阶段我们完成了什么

当前项目已经完成了 `s05` 的最小闭环实现。

也就是说，已经具备下面这套能力：

1. 本地可以存放多个 skill
2. skill 使用 `SKILL.md` 管理
3. `SKILL.md` 使用 frontmatter 定义：
   - `name`
   - `description`
4. 程序可以扫描 skills 目录并生成技能摘要
5. 技能摘要会被注入 `systemPrompt`
6. 模型可以通过 `load_skill` 按需加载 skill 正文
7. skill 正文通过 `tool_result` 回注消息流

一句话概括：

**摘要常驻 prompt，正文按需加载。**

---

## 这一章真正学到的核心思想

### 1. skill 不是普通 prompt 片段

skill 不应该被理解成“复制到 system prompt 里的大段说明”。

更准确地说：

- skill 是一份可独立存储的知识单元
- 只有在任务需要时，才把它加载到当前上下文

### 2. 摘要和正文职责不同

当前 skill 结构分成两层：

- `description`
- `content`

它们的职责完全不同：

- `description` 负责告诉模型“这个 skill 适用于什么场景”
- `content` 负责告诉模型“如果用了这个 skill，接下来该怎么做”

所以：

- 摘要必须短
- 正文必须具体

### 3. `load_skill` 是模型接口，不是内部实现

我们在代码里做了一个重要分层：

- `skills/loader.ts` 是内部读取实现
- `tools/skill.ts` 是暴露给模型的工具接口

这说明：

- loader 面向程序内部
- tool 面向模型调用

### 4. 实现出来的机制，不一定自动按理想路径使用

在测试里我们发现：

- 模型有时会用 `bash` 直接读取 skill 文件
- 不一定天然优先走 `load_skill`

这说明：

**agent 设计不只是“实现功能”，还要通过 prompt 和工具边界塑造行为。**

---

## 当前代码结构

### 1. skill 本体

[skills/task-planning/SKILL.md](C:/Users/ROG/Desktop/files/skills/task-planning/SKILL.md)  
[skills/release-note-format/SKILL.md](C:/Users/ROG/Desktop/files/skills/release-note-format/SKILL.md)

这些文件负责存储技能正文和 frontmatter 元数据。

### 2. skill 读取层

[skills/loader.ts](C:/Users/ROG/Desktop/files/skills/loader.ts)

负责：

- 扫描 `skills/`
- 解析 frontmatter
- 返回 `name`、`description`
- 按需加载 skill 正文

### 3. tool 适配层

[tools/skill.ts](C:/Users/ROG/Desktop/files/tools/skill.ts)

负责：

- 定义 `LOAD_SKILL_TOOL`
- 向 agent 暴露 `load_skill`
- 向 `agent.ts` 提供技能目录摘要

### 4. agent 集成层

[agent.ts](C:/Users/ROG/Desktop/files/agent.ts)  
[agent-loop.ts](C:/Users/ROG/Desktop/files/agent-loop.ts)

负责：

- 把 skill 摘要注入 `systemPrompt`
- 在 `TOOL_HANDLERS` 中处理 `load_skill`
- 将 skill 正文通过 `tool_result` 回注给模型

---

## 我们做过的关键实现调整

### 1. skill 文件格式改成 frontmatter

最开始的教学版本是从正文里推断 `description`。

后来重构成更接近 Claude Code 官方风格的写法：

```md
---
name: task-planning
description: 当任务较复杂、步骤较多、存在依赖关系或需要阶段性验证时，先做任务规划，再执行。
---
```

这样做的好处是：

- 元数据更明确
- 不需要猜 description
- 修改正文时不会误改摘要

### 2. 新增了多个示例 skill

当前示例包括：

- `task-planning`
- `release-note-format`

这两个 skill 分别代表两类测试场景：

- 方法型 skill
- 格式型 skill

### 3. 给 task-planning 补了与 update_todos 的边界

我们明确了：

- `task-planning` 负责规划方法
- `update_todos` 负责任务状态落地

这样可以避免“口头规划但不更新 todo”的职责冲突。

### 4. 修复了 bash 安全检测误伤

在测试 `release-note-format` 时，我们发现：

- 目录名里的 `format` 会误触发危险命令拦截

后来修复了 [tools/bash.ts](C:/Users/ROG/Desktop/files/tools/bash.ts)：

- 从简单字符串包含改为更精确的规则匹配

---

## 测试结论

### 1. task-planning 测试结果

在“先规划再执行”的测试里，模型没有稳定使用 `load_skill`。

它更倾向于：

- 先用 `bash` 读目录
- 自己读取 `SKILL.md`
- 再做规划

这说明：

- 方法型 skill 更容易被模型已有常识替代
- 即使实现了 `load_skill`，模型也未必会自动优先使用

### 2. release-note-format 测试结果

在“按项目约定生成发布说明”的测试里，模型成功调用了：

- `load_skill`
- 参数为 `release-note-format`

而且最终输出明显符合 skill 规定的结构：

- `## 标题`
- `## 变更内容`
- `## 验证`

这说明：

**当前 `s05` 机制已经被真实测试验证为可用。**

### 3. 为什么 release-note-format 更容易成功

因为它属于“格式型 skill”，更接近项目私有规则。

模型如果不加载 skill，就不容易稳定输出正确格式。

这类 skill 比较适合拿来验证 `s05` 是否真正生效。

---

## 当前已经确认的结论

1. `s05` 的最小实现已经完成
2. 当前 TypeScript 版本已经能稳定支持 skill loading
3. skill 摘要和 skill 正文的职责必须分离
4. `load_skill` 是模型接口，`SkillLoader` 是内部实现
5. “功能已存在”不等于“模型一定按你设计的路径使用”
6. 格式型 skill 比方法型 skill 更适合验证 `s05`

---

## 当前还没有做的事

虽然最小闭环已经完成，但下面这些还没做：

- skill 检索
- skill 排序
- skill 分类
- `search_skills` 工具
- skill 缓存
- 更严格的 frontmatter 校验
- skill 数量过多时的 prompt 缩减策略

这些都属于后续优化，不属于当前 `s05` 的最小教学目标。

---

## 已记录的后续问题

关于“skill 数量增多后，system prompt 里的技能摘要会越来越长”这个问题，已经单独记录在：

[docs/s05-future-question-skill-scaling.md](C:/Users/ROG/Desktop/files/docs/s05-future-question-skill-scaling.md)

这是未来工程化扩展时优先级较高的问题。

---

## 当前阶段一句话总结

如果用一句话总结当前这节 `s05`：

**我们已经在本地 TS 项目里实现并验证了 skill loading，理解了它为什么要把“技能摘要”和“技能正文”拆成两层，并确认了它在格式型 skill 上可以稳定工作。**

---

*记录日期：2026-03-17*
