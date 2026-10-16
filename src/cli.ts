import fs from 'node:fs';
import path from 'node:path';
import { generateFromHar } from './core/har';
import type { GenerateOptions, GenerateResult } from './core/types';
import { askConfirm, askInput, validateBaseURL, validateOutput } from './ui/ask';
import { isDialogSupported, selectHarFile } from './ui/dialog';
import { logger } from './ui/logger';

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
  -i, --input <path>     HAR 文件或包含 .har 的目录（缺省弹出文件选择框）
  -o, --output <dir>     生成目录（默认: ${DEFAULT_OUTPUT}）
  -b, --base-url <path>  接口基础路径（默认: ${DEFAULT_BASE_URL}）
  -w, --overwrite        覆盖相同请求参数的接口
  -y, --yes              全部使用默认值，跳过交互
      --no-dialog        禁用系统文件选择对话框
  -d, --debug            打印每个生成/跳过的接口
  -h, --help             显示帮助
  -v, --version          显示版本号

示例
  $ har-gen-api
  $ har-gen-api -i ./api.har -o mock -b /api -w
  $ har-gen-api -i ./hars -y
`;

/** 解析输入路径：命令行参数优先，其次系统对话框 */
const resolveInput = async (options: CliOptions): Promise<string | null> => {
  if (options.input) {
    return options.input;
  }

  if (options.noDialog || !isDialogSupported()) {
    return null;
  }

  return selectHarFile();
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

  if (result.generated === 0 && result.skipped === 0) {
    logger.warn('未从 HAR 文件中解析到可用的 JSON 接口');
  }

  logger.info(`生成了 ${logger.accent(String(result.generated))} 条 mock 数据`);
  if (result.skipped > 0) {
    logger.warn(`跳过 ${result.skipped} 个已存在的相同请求参数接口（可用 -w 覆盖）`);
  }

  return result;
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

  const input = await resolveInput(options);

  if (!input) {
    if (options.noDialog) {
      logger.error('未指定输入文件，请使用 -i <path> 指定 HAR 文件或目录');
      process.exitCode = 1;
      return;
    }
    logger.warn('未选择文件，已退出');
    return;
  }

  if (!fs.existsSync(input)) {
    logger.error(`文件或目录不存在：${input}`);
    process.exitCode = 1;
    return;
  }

  logger.info(`HAR 路径 ${logger.path(path.resolve(input))}`);

  let { output, baseURL, overwrite } = options;

  // -y 时全部走默认值，其余情况仅对未通过命令行提供的项进行询问
  if (!options.yes) {
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

  await generate({
    input,
    output: output ?? DEFAULT_OUTPUT,
    baseURL: baseURL ?? DEFAULT_BASE_URL,
    overwrite: overwrite ?? false,
    onProgress: options.debug
      ? ({ target }) => logger.debug(logger.dim(`写入 ${target}`))
      : undefined,
  });
};

export { HELP_TEXT };
