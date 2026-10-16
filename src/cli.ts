import fs from 'node:fs';
import path from 'node:path';
import { generateFromHar, previewHarFiles } from './core/har';
import type { GenerateOptions, GenerateResult } from './core/types';
import { askConfirm, askInput, askSelect, separator, validateBaseURL, validateOutput } from './ui/ask';
import { isDialogSupported, selectHarFile } from './ui/dialog';
import { logger, createProgressRenderer } from './ui/logger';
import { openInFileManager } from './ui/opener';

/** 构建时由 esbuild `define` 注入 */
declare const __VERSION__: string;

const DEFAULT_OUTPUT = 'mock';
const DEFAULT_BASE_URL = '/api';

export interface CliOptions {
  /** HAR 文件或目录；未提供时进入文件选择对话框 */
  input?: string;
  output?: string;
  baseURL?: string;
  overwrite?: boolean;
  /** 使用默认值跳过所有交互 */
  yes: boolean;
  /** 禁用系统文件选择对话框 */
  noDialog: boolean;
  debug: boolean;
  help: boolean;
  version: boolean;
}

/** 解析命令行参数 */
export const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    yes: false,
    noDialog: false,
    debug: false,
    help: false,
    version: false,
  };

  /** 读取 `--key value` / `--key=value` 形式的取值 */
  const readValue = (flag: string, index: number): { value: string | undefined; nextIndex: number } => {
    const [, inline] = flag.split(/=(.*)/s);
    if (inline !== undefined) {
      return { value: inline, nextIndex: index };
    }

    const next = argv[ index + 1 ];
    if (next === undefined || next.startsWith('-')) {
      return { value: undefined, nextIndex: index };
    }

    return { value: next, nextIndex: index + 1 };
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[ index ];
    const [ name ] = arg.split('=');

    switch (name) {
      case '-i':
      case '--input': {
        const { value, nextIndex } = readValue(arg, index);
        options.input = value;
        index = nextIndex;
        break;
      }

      case '-o':
      case '--output': {
        const { value, nextIndex } = readValue(arg, index);
        options.output = value;
        index = nextIndex;
        break;
      }

      case '-b':
      case '--base-url':
      case '--baseURL': {
        const { value, nextIndex } = readValue(arg, index);
        options.baseURL = value;
        index = nextIndex;
        break;
      }

      case '-w':
      case '--overwrite':
        options.overwrite = true;
        break;

      case '-y':
      case '--yes':
        options.yes = true;
        break;

      case '--no-dialog':
        options.noDialog = true;
        break;

      case '-d':
      case '--debug':
        options.debug = true;
        break;

      case '-h':
      case '--help':
        options.help = true;
        break;

      case '-v':
      case '--version':
        options.version = true;
        break;

      default:
        throw new Error(`未知参数：${arg}（使用 --help 查看可用参数）`);
    }
  }

  return options;
};

const HELP_TEXT = `
从 Chrome DevTools 导出的 .har 文件生成前端 Mock 接口文件

用法
  $ har-gen-api [options]

选项
  -i, --input <path>     HAR 文件或包含 .har 的目录
  -o, --output <dir>     生成目录（默认: ${DEFAULT_OUTPUT}）
  -b, --base-url <path>  接口基础路径（默认: ${DEFAULT_BASE_URL}）
  -w, --overwrite        覆盖相同请求参数的接口
  -y, --yes              全部使用默认值，跳过交互
      --no-dialog        禁用系统文件选择对话框
  -d, --debug            打印每个生成/跳过的接口
  -h, --help             显示帮助
  -v, --version          显示版本号

说明
  不带 -i 时弹出系统文件选择框（可切换为手动输入路径）。
  非交互式终端（管道、CI）下未提供的选项自动使用默认值。

示例
  $ har-gen-api
  $ har-gen-api -i ./api.har -o mock -b /api -w
  $ har-gen-api -i ./hars -y
`;

/** 中文按 2 列宽计算，保证摘要列对齐 */
const pad = (text: string, width: number): string => {
  let length = 0;
  for (const char of text) {
    length += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(char) ? 2 : 1;
  }
  return text + ' '.repeat(Math.max(0, width - length));
};

/** 格式化文件大小 */
const fmtBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
};

/** 解析输入路径：命令行参数优先，其次交互选择 */
const resolveInput = async (options: CliOptions): Promise<string | null> => {
  if (options.input) {
    return options.input;
  }

  // 非 TTY 无法弹对话框也无法应答菜单，交由调用方报错
  if (!process.stdin.isTTY) {
    return null;
  }

  // 系统对话框不可用（Linux 无 zenity 等）时直接手动输入
  if (options.noDialog || !isDialogSupported()) {
    return askInput('HAR 文件路径', '');
  }

  const method = await askSelect<string>({
    message: '选择 HAR 文件的方式',
    choices: [
      { name: '📁  系统文件选择对话框', value: 'dialog' },
      { name: '⌨️   手动输入路径', value: 'manual' },
      separator(),
      { name: '✖️   取消', value: 'cancel' },
    ],
  });

  if (method === 'dialog') {
    const picked = selectHarFile();
    if (picked) {
      return picked;
    }
    logger.warn('未选择文件，可改为手动输入路径');
    return resolveInput({ ...options, noDialog: true });
  }

  if (method === 'manual') {
    return askInput('HAR 文件路径（文件或目录）', '');
  }

  return null;
};

/**
 * 生成 Mock 接口文件（公共 API）。
 *
 * 不传 `options` 时进入完整交互流程；CLI 的 `-y` 等价于直接传入各默认值。
 */
export const generate = async (options: GenerateOptions): Promise<GenerateResult> => {
  const result = generateFromHar({
    ...options,
    onProgress: options.onProgress,
  });

  if (result.failed.length > 0) {
    result.failed.forEach(message => logger.warn(message));
  }

  return result;
};

/** 打印生成前的计划摘要 */
const printPlan = (options: {
  input: string;
  output: string;
  baseURL: string;
  overwrite: boolean;
}): number => {
  const previews = previewHarFiles(options.input, options.baseURL);
  const totalEntries = previews.reduce((sum, item) => sum + item.entries, 0);
  const totalBytes = previews.reduce((sum, item) => sum + item.size, 0);
  const failedFiles = previews.filter(item => item.error);

  console.log('');
  console.log(`   ${pad('HAR 文件', 10)} ${previews.length} 个（共 ${fmtBytes(totalBytes)}）`);
  for (const item of previews) {
    const name = path.basename(item.file);
    if (item.error) {
      console.log(`   ${pad('', 10)} ${logger.dim(`${name}：无法解析（${item.error}）`)}`);
    }
    else {
      console.log(`   ${pad('', 10)} ${logger.dim(`${name}：${item.entries} 条接口`)}`);
    }
  }
  console.log(`   ${pad('匹配接口', 10)} ${logger.accent(String(totalEntries))} 条（baseURL ${options.baseURL}）`);
  console.log(`   ${pad('输出目录', 10)} ${logger.path(path.resolve(options.output))}`);
  console.log(`   ${pad('覆盖已有', 10)} ${options.overwrite ? '是' : `否${logger.dim('（相同请求参数将跳过，-w 可覆盖）')}`}`);
  console.log('');

  if (failedFiles.length > 0) {
    logger.warn(`${failedFiles.length} 个文件无法解析，将被跳过`);
  }

  return totalEntries;
};

/** 打印生成结果摘要 */
const printResult = (result: GenerateResult, durationMs: number): void => {
  console.log('');
  logger.success('生成完成');
  console.log('');
  console.log(`   ${pad('输出目录', 10)} ${logger.path(result.outputDir)}`);
  console.log(`   ${pad('生成接口', 10)} ${logger.accent(String(result.generated))} 条`);
  if (result.skipped > 0) {
    console.log(`   ${pad('跳过', 10)} ${result.skipped} 条${logger.dim('（已存在相同请求参数，-w 可覆盖）')}`);
  }
  if (result.failed.length > 0) {
    console.log(`   ${pad('失败文件', 10)} ${result.failed.length} 个`);
  }
  console.log(`   ${pad('耗时', 10)} ${(durationMs / 1000).toFixed(2)} s`);
  console.log('');
};

/** CLI 主流程 */
export const runCli = async (argv: string[] = process.argv.slice(2)): Promise<void> => {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(HELP_TEXT.trimStart());
    return;
  }

  if (options.version) {
    console.log(__VERSION__);
    return;
  }

  const interactive = !options.yes && process.stdin.isTTY;
  let step = 0;
  const head = (text: string): void => {
    if (interactive) {
      const marks = [ '①', '②', '③' ];
      logger.title(`${marks[ step++ ] ?? '•'} ${text}`);
    }
  };

  head('选择 HAR 文件');

  // ① 选择 HAR 文件
  const input = await resolveInput(options);

  if (!input) {
    if (process.stdin.isTTY && !options.noDialog) {
      logger.warn('未选择文件，已退出');
      return;
    }
    logger.error('未指定输入文件，请使用 -i <path> 指定 HAR 文件或目录');
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(input)) {
    logger.error(`文件或目录不存在：${input}`);
    process.exitCode = 1;
    return;
  }

  logger.info(`HAR 路径 ${logger.path(path.resolve(input))}`);

  // ② 收集配置
  let { output, baseURL, overwrite } = options;

  if (interactive) {
    head('确认输出配置');
    if (output === undefined) {
      output = await askInput('生成路径', DEFAULT_OUTPUT, validateOutput);
    }

    if (baseURL === undefined) {
      baseURL = await askInput('baseURL路径', DEFAULT_BASE_URL, validateBaseURL);
    }

    if (overwrite === undefined) {
      overwrite = await askConfirm('是否覆盖相同的请求参数接口', false);
    }
  }

  const resolved = {
    output: output ?? DEFAULT_OUTPUT,
    baseURL: baseURL ?? DEFAULT_BASE_URL,
    overwrite: overwrite ?? false,
  };

  // ③ 预览计划并确认
  if (interactive) {
    head('确认生成计划');
    const totalEntries = printPlan({ input, ...resolved });

    if (totalEntries === 0) {
      logger.warn(`未匹配到 baseURL 为 ${resolved.baseURL} 的 JSON 接口，请检查 HAR 导出内容或用 -b 调整 baseURL`);
      process.exitCode = 0;
      return;
    }

    const ok = await askConfirm(`将生成 ${totalEntries} 条接口到 ${logger.path(path.resolve(resolved.output))}，确认开始？`, true);
    if (!ok) {
      logger.warn('已取消');
      return;
    }
  }

  const startedAt = Date.now();
  const progress = createProgressRenderer();

  const result = await generate({
    input,
    ...resolved,
    onProgress: ({ fileIndex, fileCount, written, total, target }) => {
      if (options.debug) {
        logger.debug(logger.dim(`写入 ${target}`));
        return;
      }
      progress.update(`[${fileIndex}/${fileCount}] ${written}/${total}  ${target}`);
    },
  });
  progress.done();

  printResult(result, Date.now() - startedAt);

  if (result.generated === 0 && result.skipped === 0) {
    logger.warn(`未匹配到 baseURL 为 ${resolved.baseURL} 的 JSON 接口，请检查 HAR 导出内容或用 -b 调整 baseURL`);
  }

  // 生成完成后询问是否打开输出目录
  if (interactive && result.generated > 0) {
    const shouldOpen = await askConfirm('是否打开输出目录？', true);
    if (shouldOpen) {
      openInFileManager(result.outputDir);
    }
  }
};

export { HELP_TEXT };
