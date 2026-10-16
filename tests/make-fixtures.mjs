/**
 * 生成测试用 fixtures（HAR 文件与 mock 接口文件）到 tmp/ 目录。
 * 可单独执行：node tests/make-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TMP = path.join(ROOT, 'tmp');
export const HAR_DIR = path.join(TMP, 'fixtures');
export const MOCK_DIR = path.join(TMP, 'mock');

/** 构造一条 HAR 记录 */
const entry = ({ url, method = 'GET', status = 200, resourceType = 'xhr', body = '{}', contentType = 'application/json; charset=utf-8', headers = true, encoding }) => ({
  _resourceType: resourceType,
  request: { method, url },
  response: {
    status,
    headers: headers
      ? [ { name: 'Content-Type', value: contentType } ]
      : undefined,
    content: encoding ? { text: body, encoding } : { text: body },
  },
});

/** 完整用例 HAR：覆盖各类应保留 / 应跳过的记录 */
export const FULL_HAR = {
  log: {
    entries: [
      // 保留：普通 xhr JSON
      entry({ url: 'https://example.com/api/v1/user?page=1', body: '{"code":200,"page":1}' }),
      // 保留：同一路径不同 query
      entry({ url: 'https://example.com/api/v1/user?page=2', body: '{"code":200,"page":2}' }),
      // 保留：POST
      entry({ url: 'https://example.com/api/v1/login', method: 'POST', body: '{"code":200,"token":"t"}' }),
      // 保留：fetch 类型
      entry({ url: 'https://example.com/api/v1/fetch-data', resourceType: 'fetch', body: '{"code":200}' }),
      // 保留：Firefox 等不写 _resourceType，但响应是 JSON
      entry({ url: 'https://example.com/api/v1/no-type', resourceType: undefined, body: '{"code":200}' }),
      // 保留：base64 编码的 JSON 响应
      entry({
        url: 'https://example.com/api/v1/base64',
        body: Buffer.from('{"code":200,"b64":true}').toString('base64'),
        encoding: 'base64',
      }),
      // 跳过：非 JSON 响应
      entry({ url: 'https://example.com/api/v1/avatar.png', contentType: 'image/png', body: 'binary' }),
      // 跳过：非 200
      entry({ url: 'https://example.com/api/v1/missing', status: 404, body: '{"code":404}' }),
      // 跳过：静态文档资源
      entry({ url: 'https://example.com/api/v1/page.html', resourceType: 'document', body: '{"code":200}' }),
      // 跳过：headers 缺失（不得抛错）
      entry({ url: 'https://example.com/api/v1/no-headers', headers: false, body: '{"code":200}' }),
      // 跳过：baseURL 前缀越界（/api2 不应被 /api 命中）
      entry({ url: 'https://example.com/api2/v1/other', body: '{"code":200}' }),
      // 跳过：无响应体（text 非字符串）
      entry({ url: 'https://example.com/api/v1/empty', body: null }),
    ],
  },
};

/** 非法 HAR（缺少 log.entries） */
export const BROKEN_HAR = { log: {} };

/** 非法 JSON 内容 */
export const INVALID_JSON = '{ not json }';

/** 运行时用 mock 接口文件：多 query 分支 + 兜底键 */
export const RUNTIME_MOCK_FILES = {
  'v1/user.get': `{
  '': '{"code":200,"branch":"default"}',
  '?page=1': '{"code":200,"branch":"page1"}',
  '?page=2': '{"code":200,"branch":"page2"}'
}
`,
  'v1/login.post': `{
  '': '{"code":200,"token":"mock-token"}'
}
`,
  // lodash template：把 query 注入到响应里
  'v1/echo.get': `{
  '': '{"code":200,"name":"<%= query.name %>"}'
}
`,
  // mockjs 模板语法
  'v1/random.get': `{
  '': '{"code":200,"id":"@integer(1,10)","name":"@cname"}'
}
`,
  // 历史遗留的单对象格式（无 query 键）
  'v1/legacy.get': `{
  "code": 200,
  "message": "legacy"
}
`,
};

export function makeFixtures() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(HAR_DIR, { recursive: true });
  fs.mkdirSync(MOCK_DIR, { recursive: true });

  fs.writeFileSync(path.join(HAR_DIR, 'full.har'), JSON.stringify(FULL_HAR, null, 2));
  fs.writeFileSync(path.join(HAR_DIR, 'broken.har'), JSON.stringify(BROKEN_HAR, null, 2));
  fs.writeFileSync(path.join(HAR_DIR, 'invalid.har'), INVALID_JSON);
  // 非 .har 文件应被忽略
  fs.writeFileSync(path.join(HAR_DIR, 'notes.txt'), 'ignore me');

  for (const [ relative, content ] of Object.entries(RUNTIME_MOCK_FILES)) {
    const target = path.join(MOCK_DIR, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  return { tmp: TMP, harDir: HAR_DIR, mockDir: MOCK_DIR };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = makeFixtures();
  console.log(`fixtures 已生成：${result.tmp}`);
}
