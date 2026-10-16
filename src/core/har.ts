import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import { joinMockFilePath, matchBaseURL, stripBaseURL } from './paths';
import type { GenerateProgressEvent, GenerateResult, HarEntry, MergeMockFileResult } from './types';

/** 视为可生成 Mock 的响应 content-type 特征 */
const JSON_CONTENT_TYPE = 'application/json';

/** 视为接口请求的 Chrome `_resourceType` 取值 */
const XHR_RESOURCE_TYPES = new Set([ 'xhr', 'fetch' ]);

/** 判断响应 content-type 是否为 JSON */
const isJsonResponse = (headers: unknown): boolean => {
  if (!Array.isArray(headers)) {
    return false;
  }

  return headers.some((header: any) => {
    if (!header || typeof header.name !== 'string') {
      return false;
    }
    return header.name.toLowerCase() === 'content-type'
      && String(header.value ?? '').includes(JSON_CONTENT_TYPE);
  });
};

/**
 * 判断一条 HAR 记录是否可用于生成 Mock。
 *
 * 要求：HTTP 200、响应体为 JSON、且是接口类请求。
 *
 * `_resourceType` 是 Chrome 私有字段，Firefox 等导出器不写该字段，
 * 因此仅在其存在时校验，缺失时退化为按 content-type 判断。
 */
export const isMockableEntry = (entry: any): boolean => {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  const response = entry.response;
  const request = entry.request;

  if (!response || !request || typeof request.url !== 'string' || !request.url) {
    return false;
  }

  if (response.status !== 200) {
    return false;
  }

  const resourceType = entry._resourceType;
  if (typeof resourceType === 'string' && resourceType !== '' && !XHR_RESOURCE_TYPES.has(resourceType)) {
    return false;
  }

  return isJsonResponse(response.headers);
};

/** 取出响应体文本，处理 base64 编码的 HAR 输出 */
const readResponseText = (response: any): string | null => {
  const content = response?.content;
  if (!content || typeof content.text !== 'string') {
    return null;
  }

  if (content.encoding === 'base64') {
    try {
      return Buffer.from(content.text, 'base64').toString('utf8');
    }
    catch {
      return content.text;
    }
  }

  return content.text;
};

/**
 * 从 HAR 文件内容中提取全部可用于 Mock 的请求记录。
 *
 * @throws 内容不是合法 JSON 或缺少 `log.entries` 时抛错
 */
export const extractHarEntries = (content: string, baseURL: string): HarEntry[] => {
  let data: any;

  try {
    data = JSON.parse(content);
  }
  catch {
    throw new Error('不是合法的 JSON 内容');
  }

  const entries = data?.log?.entries;
  if (!Array.isArray(entries)) {
    throw new Error('缺少 log.entries 字段，可能不是 Chrome DevTools 导出的 HAR 文件');
  }

  const result: HarEntry[] = [];

  for (const entry of entries) {
    if (!isMockableEntry(entry)) {
      continue;
    }

    const text = readResponseText(entry.response);
    if (text === null) {
      continue;
    }

    let url: URL;
    try {
      url = new URL(entry.request.url);
    }
    catch {
      continue;
    }

    if (!matchBaseURL(url.pathname, baseURL)) {
      continue;
    }

    result.push({
      pathname: stripBaseURL(url.pathname, baseURL),
      url: entry.request.url,
      method: String(entry.request.method ?? 'get').toLowerCase(),
      search: url.search,
      text,
    });
  }

  return result;
};

/**
 * 把一条接口合并进已有文件内容。
 *
 * 已有文件可能是历史遗留的「单个响应对象」格式（存在非 `?` 前缀的键），
 * 此时整体序列化为字符串挂到空键 `''` 下，再叠加新键，保证格式统一。
 */
export const mergeMockFile = (
  existingContent: string | null,
  search: string,
  text: string,
  overwrite: boolean
): MergeMockFileResult => {
  let data: Record<string, any> = { [search]: text };

  if (existingContent !== null) {
    let parsed: Record<string, any> = JSON5.parse(existingContent);

    if (Object.keys(parsed).some(key => !key.startsWith('?') && key !== '')) {
      // 必须用严格 JSON 序列化：运行时会对该字符串执行 JSON.parse
      parsed = { '': JSON.stringify(parsed) };
    }

    if (!overwrite && Object.prototype.hasOwnProperty.call(parsed, search)) {
      return { skipped: true, content: existingContent };
    }

    data = Object.assign(parsed, data);
  }

  return { skipped: false, content: JSON5.stringify(data, null, 2) };
};

/** 递归收集目录下的所有 HAR 文件（仅一层，与历史行为一致） */
const collectHarFiles = (target: string): string[] => {
  if (!fs.existsSync(target)) {
    throw new Error(`文件或目录不存在：${target}`);
  }

  if (fs.statSync(target).isFile()) {
    return target.endsWith('.har') ? [ target ] : [];
  }

  return fs
    .readdirSync(target)
    .filter(file => file.endsWith('.har'))
    .map(file => path.join(target, file));
};

/**
 * 从 HAR 文件（或目录）生成 Mock 接口文件。
 *
 * 纯文件系统操作，不含任何交互与日志输出，便于测试与复用。
 */
export const generateFromHar = (options: {
  input: string;
  output?: string;
  baseURL?: string;
  overwrite?: boolean;
  onProgress?: (event: GenerateProgressEvent) => void;
}): GenerateResult => {
  const output = options.output ?? 'mock';
  const baseURL = options.baseURL ?? '/api';
  const overwrite = options.overwrite ?? false;

  const files = collectHarFiles(options.input);
  const outputDir = path.resolve(process.cwd(), output);

  const result: GenerateResult = {
    generated: 0,
    skipped: 0,
    failed: [],
    files: [],
    outputDir,
  };

  files.forEach((file, index) => {
    let entries: HarEntry[];

    try {
      entries = extractHarEntries(fs.readFileSync(file, 'utf8'), baseURL);
    }
    catch (error) {
      result.failed.push(`${file}：${(error as Error).message}`);
      return;
    }

    result.files.push(file);

    entries.forEach((entry, entryIndex) => {
      const relativePath = joinMockFilePath(output, entry.pathname, entry.method);
      const filePath = path.resolve(process.cwd(), relativePath);
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;

      const merged = mergeMockFile(existing, entry.search, entry.text, overwrite);

      if (merged.skipped) {
        result.skipped += 1;
      }
      else {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, merged.content);
        result.generated += 1;
      }

      options.onProgress?.({
        file,
        fileIndex: index + 1,
        fileCount: files.length,
        written: entryIndex + 1,
        total: entries.length,
        target: relativePath,
      });
    });
  });

  return result;
};
