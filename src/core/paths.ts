import path from 'node:path';

/**
 * 判断 pathname 是否命中 baseURL 前缀。
 *
 * 用字符串前缀 + 路径边界判断，而不是 `new RegExp('^' + baseURL)`：
 * 1. baseURL 含正则元字符（如 `.` `(` `+`）时不会报错或误匹配；
 * 2. `/api` 不会错误命中 `/api2/users` 这类仅前缀相同的路径。
 */
export const matchBaseURL = (pathname: string, baseURL: string): boolean => {
  if (!baseURL || baseURL === '/') {
    return true;
  }

  const prefix = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;

  return pathname === prefix || pathname.startsWith(`${prefix}/`);
};

/**
 * 剥离 baseURL 前缀，返回剩余路径。
 *
 * 与 {@link matchBaseURL} 保持同一套边界规则，未命中时原样返回。
 */
export const stripBaseURL = (pathname: string, baseURL: string): string => {
  if (!matchBaseURL(pathname, baseURL)) {
    return pathname;
  }

  if (!baseURL || baseURL === '/') {
    return pathname;
  }

  const prefix = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
  const rest = pathname.slice(prefix.length);

  return rest === '' ? '/' : rest;
};

/**
 * 拼接接口文件路径（相对形式），并把重复斜杠压缩为单个。
 *
 * `include` / `pathname` 均可能是相对或绝对路径，压缩仅针对 `/`，
 * 不会破坏 Windows 盘符与反斜杠。
 */
export const joinMockFilePath = (
  include: string,
  pathname: string,
  method: string
): string => `${include}/${pathname}.${method}`.replace(/\/+/g, '/');

/**
 * 解析出接口文件的绝对路径，便于 fs 直接读取。
 */
export const resolveMockFilePath = (
  include: string,
  pathname: string,
  method: string,
  cwd: string = process.cwd()
): string => path.resolve(cwd, joinMockFilePath(include, pathname, method));
