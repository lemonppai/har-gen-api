import chalk from 'chalk';
import logSymbols from 'log-symbols';

/** 本项目日志统一前缀 */
const TAG = chalk.cyan.bold('[har-gen-api]');

/** 统一日志出口，避免各处重复拼接 chalk 与 logSymbols */
export const logger = {
  /** 普通信息 */
  info(message: string): void {
    console.log(`${TAG} ${message}`);
  },

  /** 成功 */
  success(message: string): void {
    console.log(`${chalk.green(logSymbols.success)} ${message}`);
  },

  /** 警告 */
  warn(message: string): void {
    console.log(`${chalk.yellow(logSymbols.warning)} ${message}`);
  },

  /** 错误（写 stderr） */
  error(message: string): void {
    console.error(`${chalk.red(logSymbols.error)} ${message}`);
  },

  /** 带前缀的调试日志 */
  debug(message: string): void {
    console.log(`${TAG} ${message}`);
  },

  /** 标题 */
  title(message: string): void {
    console.log(chalk.bold.cyan(message));
  },

  /** 次要信息着色 */
  dim: (message: string): string => chalk.gray(message),

  /** 强调信息着色 */
  accent: (message: string): string => chalk.green(message),

  /** 路径着色 */
  path: (message: string): string => chalk.cyan(message),
};

/** 单行进度渲染（仅在 TTY 下重绘，避免污染日志与管道输出） */
export function createProgressRenderer(): {
  update: (text: string) => void;
  done: () => void;
} {
  const enabled = Boolean(process.stderr.isTTY);
  let lastLength = 0;

  return {
    update(text: string): void {
      if (!enabled) return;
      const line = text.length > 110 ? `${text.slice(0, 107)}...` : text;
      process.stderr.write(`\r${' '.repeat(lastLength)}\r${line}`);
      lastLength = line.length;
    },
    done(): void {
      if (!enabled || lastLength === 0) return;
      process.stderr.write(`\r${' '.repeat(lastLength)}\r`);
      lastLength = 0;
    },
  };
}
