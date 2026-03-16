import * as fs from "fs";
import * as path from "path";
import { LoadedSkill, SkillMeta } from "../types";

const SKILL_FILE = "SKILL.md";

interface SkillFrontmatter {
  name: string;
  description: string;
}

// 解析 Claude Code 风格的 frontmatter，把元数据和正文拆开。
function parseFrontmatter(markdown: string): { meta: SkillFrontmatter; content: string } {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error("Skill file is missing frontmatter.");
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error("Skill frontmatter is not closed.");
  }

  const metaLines = lines.slice(1, endIndex);
  const meta: Partial<SkillFrontmatter> = {};

  for (const rawLine of metaLines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(`Invalid frontmatter line: "${rawLine}"`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    // 当前 agent 只关心 name 和 description 这两个字段。
    if (key === "name" || key === "description") {
      meta[key] = value;
    }
  }

  if (!meta.name) {
    throw new Error('Skill frontmatter is missing "name".');
  }

  if (!meta.description) {
    throw new Error('Skill frontmatter is missing "description".');
  }

  const content = lines.slice(endIndex + 1).join("\n").trim();

  return {
    meta: {
      name: meta.name,
      description: meta.description,
    },
    content,
  };
}

export class SkillLoader {
  constructor(private readonly rootDir: string = path.join(process.cwd(), "skills")) {}

  // 扫描本地 skills 目录，只返回轻量元数据，供 system prompt 生成技能目录摘要。
  listSkills(): SkillMeta[] {
    if (!fs.existsSync(this.rootDir)) {
      return [];
    }

    return fs
      .readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const dirPath = path.join(this.rootDir, entry.name);
        const skillFilePath = path.join(dirPath, SKILL_FILE);
        if (!fs.existsSync(skillFilePath)) {
          return null;
        }

        const rawContent = fs.readFileSync(skillFilePath, "utf-8");
        const { meta } = parseFrontmatter(rawContent);
        return {
          // skill 的公开名称来自 frontmatter，不直接依赖文件夹名。
          name: meta.name,
          description: meta.description,
          dirPath,
          skillFilePath,
        } satisfies SkillMeta;
      })
      .filter((skill): skill is SkillMeta => skill !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // 把所有 skill 的 name/description 拼成一段简短目录，注入 system prompt。
  listSkillSummaries(): string {
    const skills = this.listSkills();
    if (skills.length === 0) {
      return "当前没有安装任何本地技能。";
    }

    return skills
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join("\n");
  }

  // 只有当模型明确请求某个 skill 时，才加载完整正文。
  loadSkill(name: string): LoadedSkill {
    const normalizedName = name.trim();
    const skill = this.listSkills().find((item) => item.name === normalizedName);

    if (!skill) {
      const available = this.listSkills().map((item) => item.name).join(", ");
      throw new Error(
        available
          ? `未知技能 "${normalizedName}"。可用技能：${available}`
          : `未知技能 "${normalizedName}"。当前没有安装任何本地技能。`
      );
    }

    return {
      ...skill,
      // 返回给 tool_result 的应该是技能正文，而不是 frontmatter。
      content: parseFrontmatter(fs.readFileSync(skill.skillFilePath, "utf-8")).content,
    };
  }
}
