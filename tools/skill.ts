import Anthropic from "@anthropic-ai/sdk";
import { SkillLoader } from "../skills/loader";

export const LOAD_SKILL_TOOL: Anthropic.Tool = {
  name: "load_skill",
  description: [
    "当任务需要特定操作规范或领域知识时，加载本地 skill 的完整正文。",
    "先根据 system prompt 里的技能目录判断需要哪个 skill，再调用这个工具。",
  ].join("\n"),
  input_schema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "要加载的本地 skill 的精确名称。",
      },
    },
    required: ["name"],
  },
};

const skillLoader = new SkillLoader();

export function getSkillSummaries(): string {
  return skillLoader.listSkillSummaries();
}

export function loadSkill(name: string): string {
  const skill = skillLoader.loadSkill(name);
  return [`# 技能: ${skill.name}`, skill.content].join("\n\n");
}
