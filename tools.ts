import { execSync, ExecSyncOptionsWithStringEncoding } from "child_process";
import * as path from "path";

// 危险命令黑名单
const DANGEROUS_PATTERNS = [
  "rm -rf",
  "sudo",
  "shutdown",
  "reboot",
  "> /dev/",
  "format",
  "del /f /s",
  "rd /s /q",
  "reg delete",
  "taskkill",
];

function checkDangerous(command: string): void {
  const lower = command.toLowerCase();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (lower.includes(pattern)) {
      throw new Error(`命令被拒绝：包含危险操作 "${pattern}"`);
    }
  }
}

// 工具执行超时（毫秒）
const DEFAULT_TIMEOUT_MS = 30_000;

// 输出最大字符数（避免 context 被单次工具结果撑爆）
const MAX_OUTPUT_CHARS = 10_000;

/**
 * 执行 shell 命令，返回 stdout + stderr 合并字符串。
 *
 * 与 Python 版 subprocess.run() 的对应关系：
 *   Python: result.stdout + result.stderr
 *   JS:     execSync 成功 → stdout，失败 → catch error.stdout + error.stderr
 *
 * 为什么用 execSync（同步）而不是 exec（异步）？
 *   s01 是最小 agent 内核，同步调用和 Python 行为完全一致，
 *   便于理解。s08 开始才需要真正的后台异步执行。
 */
export function bashTool(command: string): string {
  const options: ExecSyncOptionsWithStringEncoding = {
    encoding: "utf-8",
    stdio: "pipe",           // 捕获 stdout / stderr，不直接打印到终端
    timeout: DEFAULT_TIMEOUT_MS,
    shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
    cwd: process.cwd(),      // 工作目录继承当前进程
    env: {
      ...process.env,
      // 确保命令行工具输出不带颜色转义码
      TERM: "dumb",
      NO_COLOR: "1",
    },
  };

  // 执行前检查危险命令
  checkDangerous(command);

  // Windows cmd.exe 默认 GBK，切换为 UTF-8（代码页 65001）避免中文乱码
  const wrappedCommand =
    process.platform === "win32" ? `chcp 65001 >nul && ${command}` : command;

  let output: string;

  try {
    output = execSync(wrappedCommand, options);
  } catch (err: unknown) {
    // execSync 在非零退出码时抛出 Error
    // error.stdout / error.stderr 仍包含命令输出
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    const stdout = e.stdout ?? "";
    const stderr = e.stderr ?? "";
    const exitCode = (e as any).status ?? "?";
    output = [
      stdout,
      stderr && `[stderr]\n${stderr}`,
      `[exit code: ${exitCode}]`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // 截断超长输出，防止 context 被撑爆
  if (output.length > MAX_OUTPUT_CHARS) {
    const half = Math.floor(MAX_OUTPUT_CHARS / 2);
    output =
      output.slice(0, half) +
      `\n\n...[输出过长，已截断 ${output.length - MAX_OUTPUT_CHARS} 字符]...\n\n` +
      output.slice(-half);
  }

  return output || "(无输出)";
}

/**
 * 安全路径检查（可选）：限制 agent 只能操作指定目录内的文件。
 * 在生产环境中应当启用，学习阶段可忽略。
 */
export function isSafePath(filePath: string, allowedRoot: string): boolean {
  const resolved = path.resolve(filePath);
  const root = path.resolve(allowedRoot);
  return resolved.startsWith(root + path.sep) || resolved === root;
}
