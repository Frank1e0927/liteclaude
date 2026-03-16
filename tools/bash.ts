import { execSync, ExecSyncOptionsWithStringEncoding } from "child_process";
import * as path from "path";

interface DangerousRule {
  label: string;
  pattern: RegExp;
}

// 用更精确的规则匹配危险命令，避免路径名里包含关键字时被误伤。
const DANGEROUS_RULES: DangerousRule[] = [
  { label: "rm -rf", pattern: /(^|[;&|]\s*|\b)rm\s+-rf\b/i },
  { label: "sudo", pattern: /(^|[;&|]\s*|\b)sudo\b/i },
  { label: "shutdown", pattern: /(^|[;&|]\s*|\b)shutdown\b/i },
  { label: "reboot", pattern: /(^|[;&|]\s*|\b)reboot\b/i },
  { label: "> /dev/", pattern: />\s*\/dev\//i },
  { label: "format", pattern: /(^|[;&|]\s*|\b)format\b/i },
  { label: "del /f /s", pattern: /(^|[;&|]\s*|\b)del\s+\/f\s+\/s\b/i },
  { label: "rd /s /q", pattern: /(^|[;&|]\s*|\b)rd\s+\/s\s+\/q\b/i },
  { label: "reg delete", pattern: /(^|[;&|]\s*|\b)reg\s+delete\b/i },
  { label: "taskkill", pattern: /(^|[;&|]\s*|\b)taskkill\b/i },
];

function checkDangerous(command: string): void {
  for (const rule of DANGEROUS_RULES) {
    if (rule.pattern.test(command)) {
      throw new Error(`命令被拒绝：包含危险操作 "${rule.label}"`);
    }
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 10_000;

/**
 * 执行 shell 命令并返回 stdout + stderr。
 * 这个项目里 bash 工具是通用执行器，因此会在这里做最基础的安全拦截和输出裁剪。
 */
export function bashTool(command: string): string {
  const options: ExecSyncOptionsWithStringEncoding = {
    encoding: "utf-8",
    stdio: "pipe",
    timeout: DEFAULT_TIMEOUT_MS,
    shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: "dumb",
      NO_COLOR: "1",
    },
  };

  checkDangerous(command);

  // Windows cmd 默认编码常常不是 UTF-8，先切到 65001 避免中文输出乱码。
  const wrappedCommand =
    process.platform === "win32" ? `chcp 65001 >nul && ${command}` : command;

  let output: string;

  try {
    output = execSync(wrappedCommand, options);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    const stdout = e.stdout ?? "";
    const stderr = e.stderr ?? "";
    const exitCode = e.status ?? "?";

    output = [stdout, stderr && `[stderr]\n${stderr}`, `[exit code: ${exitCode}]`]
      .filter(Boolean)
      .join("\n");
  }

  if (output.length > MAX_OUTPUT_CHARS) {
    const half = Math.floor(MAX_OUTPUT_CHARS / 2);
    output =
      output.slice(0, half) +
      `\n\n...[输出已裁剪 ${output.length - MAX_OUTPUT_CHARS} 个字符]...\n\n` +
      output.slice(-half);
  }

  return output || "(无输出)";
}

/**
 * 判断路径是否仍然位于允许的根目录之下，避免工具越界访问。
 */
export function isSafePath(filePath: string, allowedRoot: string): boolean {
  const resolved = path.resolve(filePath);
  const root = path.resolve(allowedRoot);
  return resolved.startsWith(root + path.sep) || resolved === root;
}
