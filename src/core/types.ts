/**
 * 公共类型定义
 */

/** Mock 服务（Vite 插件 / Webpack 插件）配置 */
export interface MockServerOptions {
  /** 存放接口文件的目录（相对于项目根目录），缺省 `mock` */
  include?: string;
  /** 需要拦截的接口基础路径，缺省空字符串（拦截全部） */
  baseURL?: string;
  /** 是否启用 Mock 服务，缺省 `false` */
  enabled?: boolean;
  /** 开启后打印每个被拦截的请求方法和路径，缺省 `false` */
  debug?: boolean;
}

/** 归一化后的 Mock 服务配置 */
export type NormalizedMockServerOptions = Required<MockServerOptions>;

/** 生成阶段的进度事件 */
export interface GenerateProgressEvent {
  /** 当前处理的 HAR 文件路径 */
  file: string;
  /** 文件序号（从 1 开始） */
  fileIndex: number;
  /** HAR 文件总数 */
  fileCount: number;
  /** 当前文件内已写入的接口数 */
  written: number;
  /** 当前文件内匹配到的接口总数 */
  total: number;
  /** 相对输出目录的接口文件路径 */
  target: string;
}

/** 生成入参 */
export interface GenerateOptions {
  /** HAR 文件或包含 HAR 文件的目录 */
  input: string;
  /** 生成的接口文件目录，缺省 `mock` */
  output?: string;
  /** 接口基础路径，缺省 `/api` */
  baseURL?: string;
  /** 是否覆盖相同请求参数的接口，缺省 `false` */
  overwrite?: boolean;
  /** 进度回调 */
  onProgress?: (event: GenerateProgressEvent) => void;
}

/** 单次生成的结果统计 */
export interface GenerateResult {
  /** 成功写入的接口数 */
  generated: number;
  /** 因已存在相同请求参数而跳过的接口数 */
  skipped: number;
  /** 解析失败的 HAR 文件 */
  failed: string[];
  /** 实际处理的 HAR 文件列表 */
  files: string[];
  /** 输出目录绝对路径 */
  outputDir: string;
}

/** HAR 中一条可用的请求记录 */
export interface HarEntry {
  /** 去重后的相对路径（已剥离 baseURL） */
  pathname: string;
  /** 原始完整 URL */
  url: string;
  /** 小写请求方法 */
  method: string;
  /** query 串（含前导 `?`，无 query 时为空字符串） */
  search: string;
  /** 响应体文本 */
  text: string;
}

/** 已存在接口文件的合并结果 */
export interface MergeMockFileResult {
  /** 是否因存在相同请求参数而跳过 */
  skipped: boolean;
  /** 需要写入的内容 */
  content: string;
}
