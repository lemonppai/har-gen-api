import Mock from 'mockjs';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import JSON5 from 'json5';

export interface MockServerOptions {
  /** 存放接口文件的目录（相对于项目根目录） */
  include?: string;
  /** 需要 Mock 的接口基础路径 */
  baseURL?: string;
  /** 是否启用 Mock 服务 */
  enabled?: boolean;
  /** 开启后控制台会打印每个被拦截的请求方法和路径 */
  debug?: boolean;
}

/**
 * 解析并生成响应数据
 * 1. 按 query 精确匹配 -> 降级到 ? 开头或空字符串的兜底 key -> 最后整体作为数据
 * 2. 字符串数据走 lodash template 编译，可注入 headers / query / body
 * 3. 最终交给 mockjs 做模板语法解析
 */
export const parseMockData = (raw: string, req: any): any => {
  let data: Record<string, any> = JSON5.parse(raw);
  const keys = Object.keys(data).filter(key => key.startsWith('?') || key === '');

  keys.sort((a, b) => {
    return a > b ? 1 : -1;
  });

  const url: URL = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  data = data[ url.search ] ?? data[ keys[0] ] ?? data;

  if (_.isString(data)) {
    // 模板解析
    const dataStr: string = _.template(data)({
      headers: req.headers,
      query: (req as any).query,
      body: (req as any).body,
    });

    data = dataStr ? JSON.parse(dataStr) : null;
  }

  return Mock.mock(data);
};

/**
 * 读取接口文件并生成响应数据
 * @returns 解析成功返回数据，文件不存在返回 null
 */
export const readMockData = (filePath: string, req: any): any => {
  const fileData = fs.readFileSync(filePath);
  return parseMockData(fileData.toString(), req);
};

/**
 * 拼接接口文件路径
 */
export const resolveMockFilePath = (include: string, pathname: string, method: string, cwd = process.cwd()): string => {
  const filePath = path.resolve(cwd, `${include}/${pathname}.${method}`.replace(/\/+/g, '/'));
  return filePath;
};

/**
 * 通用请求处理器：命中返回 Mock 数据，未命中执行 next()
 */
export const handleMockRequest = (
  options: Required<MockServerOptions>,
  req: any,
  res: any,
  next: Function
): void => {
  const { include, baseURL, debug } = options;
  const url: URL = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname: string = url.pathname;

  if (!pathname.startsWith(baseURL)) {
    next();
    return;
  }

  pathname = pathname.replace(new RegExp(`^${baseURL}`), '');

  if (debug) {
    console.log(`[har-gen-api] [${req.method}] ${url.pathname}`);
  }

  const filePath: string = resolveMockFilePath(include, pathname, String(req.method).toLowerCase());

  fs.readFile(filePath, (err: NodeJS.ErrnoException | null, fileData: Buffer) => {
    if (err) {
      next();
      return;
    }

    res.setHeader('X-Powered-By', 'mockjs');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    try {
      const data: any = parseMockData(fileData.toString(), req);
      res.end(JSON.stringify(data));
    }
    catch (e) {
      console.error(e);
      res.statusCode = 500;
      res.end('Mock Error');
    }
  });
};

export const normalizeOptions = (options: MockServerOptions = {}): Required<MockServerOptions> => ({
  include: options.include ?? 'mock',
  baseURL: options.baseURL ?? '',
  enabled: options.enabled ?? false,
  debug: options.debug ?? false,
});
