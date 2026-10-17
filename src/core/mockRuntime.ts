import fs from 'node:fs';
import Mock from 'mockjs';
import isString from 'lodash/isString';
import template from 'lodash/template';
import JSON5 from 'json5';
import { resolveMockFilePath, stripBaseURL, matchBaseURL } from './paths';
import type { MockServerOptions, NormalizedMockServerOptions } from './types';

/** 归一化 Mock 服务配置，填充默认值 */
export const normalizeOptions = (
  options: MockServerOptions = {}
): NormalizedMockServerOptions => ({
  include: options.include ?? 'mock',
  baseURL: options.baseURL ?? '',
  enabled: options.enabled ?? false,
  debug: options.debug ?? false,
});

/** 从请求对象解析出 URL（host 缺失时退化到 localhost） */
const parseRequestURL = (req: any): URL => {
  const host = req?.headers?.host ?? 'localhost';
  return new URL(req?.url ?? '/', `http://${host}`);
};

/**
 * 解析接口文件内容并生成最终响应数据。
 *
 * 取值优先级：`query` 精确匹配 → `?` 开头 / 空字符串的兜底键（按字典序取首个）→ 整体作为数据。
 * 字符串数据会先经 lodash template 编译（可注入 `headers` / `query` / `body`），
 * 再交给 mockjs 解析模板语法。
 */
export const parseMockData = (raw: string, req: any): any => {
  const parsed: Record<string, any> = JSON5.parse(raw);

  const fallbackKeys = Object.keys(parsed)
    .filter(key => key.startsWith('?') || key === '')
    .sort((a, b) => (a > b ? 1 : -1));

  const url = parseRequestURL(req);
  let data: any = parsed[ url.search ] ?? parsed[ fallbackKeys[0] ] ?? parsed;

  if (isString(data)) {
    const rendered: string = template(data)({
      headers: req?.headers ?? {},
      query: req?.query ?? {},
      body: req?.body ?? {},
    });

    data = rendered ? JSON.parse(rendered) : null;
  }

  return Mock.mock(data);
};

/** 读取接口文件并生成响应数据 */
export const readMockData = (filePath: string, req: any): any =>
  parseMockData(fs.readFileSync(filePath, 'utf8'), req);

/**
 * 通用请求处理器：命中接口文件则返回 Mock 数据，否则执行 `next()` 放行。
 *
 * 读不到文件（接口未生成）走 `next()`，交给后续中间件 / 代理处理；
 * 文件存在但解析失败则返回 500，便于暴露 mock 数据本身的问题。
 */
export const handleMockRequest = (
  options: NormalizedMockServerOptions,
  req: any,
  res: any,
  next: Function
): void => {
  const url = parseRequestURL(req);

  if (!matchBaseURL(url.pathname, options.baseURL)) {
    next();
    return;
  }

  const pathname = stripBaseURL(url.pathname, options.baseURL);

  if (options.debug) {
    console.log(`[har-gen-api] [${req.method}] ${url.pathname}`);
  }

  const filePath = resolveMockFilePath(options.include, pathname, String(req.method ?? 'get').toLowerCase());

  fs.readFile(filePath, (error: NodeJS.ErrnoException | null, fileData: Buffer) => {
    if (error) {
      next();
      return;
    }

    res.setHeader('X-Powered-By', 'mockjs');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    try {
      res.end(JSON.stringify(parseMockData(fileData.toString(), req)));
    }
    catch (error_) {
      console.error(error_);
      res.statusCode = 500;
      res.end('Mock Error');
    }
  });
};
