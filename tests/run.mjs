/**
 * 端到端验证：node tests/run.mjs
 * 依赖 dist 构建产物，请先执行 npm run build
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import { HAR_DIR, MOCK_DIR, TMP, makeFixtures } from './make-fixtures.mjs';
import {
  extractHarEntries,
  generateFromHar,
  isMockableEntry,
  joinMockFilePath,
  matchBaseURL,
  mergeMockFile,
  parseArgs,
  stripBaseURL,
} from '../dist/index.js';
import { mockServer as viteMockServer } from '../dist/vite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let skipped = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  }
  catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

/**
 * 进程级用例。部分受限环境（如无子进程权限的沙箱）会直接拒绝 spawn，
 * 此时标记 SKIP 而不是判定失败，避免掩盖真实回归。
 */
async function testProcess(name, fn) {
  const probe = spawnSync(process.execPath, [ '-e', '0' ], { encoding: 'utf8' });

  if (probe.error) {
    skipped += 1;
    console.log(`  SKIP  ${name}（当前环境无法创建子进程：${probe.error.code ?? probe.error.message}）`);
    return;
  }

  await test(name, fn);
}

/** 启动临时 http 服务，挂载中间件后发起一次请求 */
function request(middleware, url, { method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      middleware(req, res, () => {
        res.statusCode = 404;
        res.end('NEXT');
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const options = new URL(url.replace('PORT', String(port)));
      const clientRequest = http.request(
        { hostname: options.hostname, port: options.port, path: options.pathname + options.search, method },
        (res) => {
          let body = '';
          res.on('data', chunk => (body += chunk));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body, headers: res.headers });
          });
        }
      );

      clientRequest.on('error', (error) => {
        server.close();
        reject(error);
      });
      clientRequest.end();
    });
  });
}

/** 递归列出目录下所有文件的相对路径 */
function listFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** 构造 webpack compiler 桩 */
function createCompiler(devServer) {
  const hooks = {};
  return {
    options: { devServer },
    hooks: { afterEnvironment: { tap: (_name, fn) => (hooks.afterEnvironment = fn) } },
    run: () => hooks.afterEnvironment?.(),
  };
}

const filePath = (file) => path.join(TMP, 'out', file);

async function main() {
  makeFixtures();
  const { mockServer: webpackMockServer } = await import('../dist/webpack.cjs');

  // ---------------------------------------------------------------- 路径工具
  console.log('\n[路径与 baseURL 边界]');

  await test('matchBaseURL 按路径边界匹配，不误命中 /api2', () => {
    assert.equal(matchBaseURL('/api/v1/user', '/api'), true);
    assert.equal(matchBaseURL('/api', '/api'), true);
    assert.equal(matchBaseURL('/api2/v1/user', '/api'), false);
    assert.equal(matchBaseURL('/apix', '/api'), false);
    assert.equal(matchBaseURL('/anything', ''), true);
    assert.equal(matchBaseURL('/api/v1', '/api/'), true);
  });

  await test('matchBaseURL 支持含正则元字符的前缀', () => {
    assert.equal(matchBaseURL('/a.b/c', '/a.b'), true);
    assert.equal(matchBaseURL('/axb/c', '/a.b'), false);
  });

  await test('stripBaseURL 剥离前缀并保留前导斜杠', () => {
    assert.equal(stripBaseURL('/api/v1/user', '/api'), '/v1/user');
    assert.equal(stripBaseURL('/api', '/api'), '/');
    assert.equal(stripBaseURL('/api2/v1', '/api'), '/api2/v1');
    assert.equal(stripBaseURL('/v1', ''), '/v1');
  });

  await test('joinMockFilePath 压缩重复斜杠', () => {
    assert.equal(joinMockFilePath('mock', '/v1/user', 'get'), 'mock/v1/user.get');
    assert.equal(joinMockFilePath('mock/', '/v1/user', 'post'), 'mock/v1/user.post');
  });

  // ------------------------------------------------------------------ HAR 解析
  console.log('\n[HAR 解析]');

  const harContent = fs.readFileSync(path.join(HAR_DIR, 'full.har'), 'utf8');
  const entries = extractHarEntries(harContent, '/api');

  await test('只保留可用的 JSON 接口记录', () => {
    const urls = entries.map(item => item.url).sort();
    assert.deepEqual(urls, [
      'https://example.com/api/v1/base64',
      'https://example.com/api/v1/fetch-data',
      'https://example.com/api/v1/login',
      'https://example.com/api/v1/no-type',
      'https://example.com/api/v1/user?page=1',
      'https://example.com/api/v1/user?page=2',
    ]);
  });

  await test('base64 响应体被解码为 JSON 文本', () => {
    const target = entries.find(item => item.url.endsWith('/base64'));
    assert.equal(JSON.parse(target.text).b64, true);
  });

  await test('method 统一小写、search 保留前导问号', () => {
    const login = entries.find(item => item.url.endsWith('/login'));
    assert.equal(login.method, 'post');
    assert.equal(entries.find(item => item.url.endsWith('page=1')).search, '?page=1');
  });

  await test('headers 缺失的记录不抛错且被跳过', () => {
    assert.equal(isMockableEntry({ response: { status: 200 }, request: { url: 'https://x/a' } }), false);
  });

  await test('非法 HAR 抛出可读错误', () => {
    assert.throws(() => extractHarEntries('{}', '/api'), /log\.entries/);
    assert.throws(() => extractHarEntries('{ oops', '/api'), /合法的 JSON/);
  });

  // ------------------------------------------------------------------ 文件合并
  console.log('\n[接口文件合并]');

  await test('新建文件写入 query 键', () => {
    const merged = mergeMockFile(null, '?page=1', '{"a":1}', false);
    assert.equal(merged.skipped, false);
    assert.deepEqual(Object.keys(JSON5.parse(merged.content)), [ '?page=1' ]);
  });

  await test('overwrite=false 时相同 query 被跳过', () => {
    const existing = mergeMockFile(null, '?page=1', '{"a":1}', false).content;
    assert.equal(mergeMockFile(existing, '?page=1', '{"a":2}', false).skipped, true);
  });

  await test('overwrite=true 时覆盖相同 query', () => {
    const existing = mergeMockFile(null, '?page=1', '{"a":1}', false).content;
    const merged = mergeMockFile(existing, '?page=1', '{"a":2}', true);
    assert.equal(merged.skipped, false);
    assert.deepEqual(Object.keys(JSON5.parse(merged.content)), [ '?page=1' ]);
    assert.match(merged.content, /"a":2/);
  });

  await test('不同 query 叠加为多个键', () => {
    const first = mergeMockFile(null, '?page=1', '{"a":1}', false).content;
    const second = mergeMockFile(first, '?page=2', '{"a":2}', false).content;
    assert.deepEqual(Object.keys(JSON5.parse(second)), [ '?page=1', '?page=2' ]);
  });

  await test('历史单对象格式被包装到空键下，且内层为严格 JSON', () => {
    const legacy = '{\n  "code": 200,\n  "message": "legacy"\n}';
    const merged = mergeMockFile(legacy, '?page=1', '{"a":1}', false);
    const parsed = JSON5.parse(merged.content);

    assert.deepEqual(Object.keys(parsed).sort(), [ '', '?page=1' ]);
    // 运行时会对该字符串执行 JSON.parse，必须是严格 JSON
    assert.equal(JSON.parse(parsed['']).code, 200);
    assert.equal(parsed['?page=1'], '{"a":1}');
  });

  // -------------------------------------------------------------------- 生成
  console.log('\n[从 HAR 生成]');

  await test('目录输入生成接口文件并跳过非法 HAR', () => {
    const result = generateFromHar({ input: HAR_DIR, output: 'tmp/out', baseURL: '/api', overwrite: true });
    assert.equal(result.generated, 6);
    assert.equal(result.failed.length, 2);
    assert.deepEqual(listFiles(path.join(TMP, 'out')), [
      'v1/base64.get',
      'v1/fetch-data.get',
      'v1/login.post',
      'v1/no-type.get',
      'v1/user.get',
    ]);
  });

  await test('同一路径不同 query 合并进同一文件', () => {
    const parsed = JSON5.parse(fs.readFileSync(filePath('v1/user.get'), 'utf8'));
    assert.deepEqual(Object.keys(parsed).sort(), [ '?page=1', '?page=2' ]);
  });

  await test('overwrite=false 统计跳过数量', () => {
    const result = generateFromHar({ input: HAR_DIR, output: 'tmp/out', baseURL: '/api', overwrite: false });
    assert.equal(result.generated, 0);
    assert.equal(result.skipped, 6);
  });

  await test('单文件输入同样可用', () => {
    const result = generateFromHar({
      input: path.join(HAR_DIR, 'full.har'),
      output: 'tmp/out-single',
      baseURL: '/api',
      overwrite: true,
    });
    assert.equal(result.generated, 6);
  });

  await test('输入不存在时抛出错误', () => {
    assert.throws(
      () => generateFromHar({ input: path.join(TMP, 'nope.har'), output: 'tmp/x' }),
      /不存在/
    );
  });

  // -------------------------------------------------------------- Vite 中间件
  console.log('\n[Vite 插件链路]');

  const vitePlugin = viteMockServer({ include: MOCK_DIR, baseURL: '/api', enabled: true });
  const middlewares = [];
  vitePlugin.configureServer({ middlewares: { use: fn => middlewares.push(fn) } });
  const viteMiddleware = middlewares[0];

  await test('插件注册了中间件', () => {
    assert.equal(typeof viteMiddleware, 'function');
    assert.equal(vitePlugin.name, 'mock-server');
  });

  await test('query 精确匹配返回对应分支', async () => {
    const res = await request(viteMiddleware, 'http://127.0.0.1:PORT/api/v1/user?page=1');
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).branch, 'page1');
  });

  await test('query 未命中时回退到兜底键', async () => {
    const res = await request(viteMiddleware, 'http://127.0.0.1:PORT/api/v1/user?page=999');
    assert.equal(JSON.parse(res.body).branch, 'default');
  });

  await test('设置 mockjs 响应头', async () => {
    const res = await request(viteMiddleware, 'http://127.0.0.1:PORT/api/v1/login', { method: 'POST' });
    assert.equal(res.headers['x-powered-by'], 'mockjs');
    assert.match(res.headers['content-type'], /application\/json/);
  });

  await test('lodash template 可注入 query', async () => {
    const res = await request(viteMiddleware, 'http://127.0.0.1:PORT/api/v1/echo?name=har');
    assert.equal(JSON.parse(res.body).name, 'har');
  });

  await test('mockjs 模板语法被解析', async () => {
    const res = await request(viteMiddleware, 'http://127.0.0.1:PORT/api/v1/random');
    const data = JSON.parse(res.body);
    assert.equal(typeof data.id, 'number');
    assert.ok(data.id >= 1 && data.id <= 10);
  });

  await test('历史单对象格式仍可直接返回', async () => {
    const res = await request(viteMiddleware, 'http://127.0.0.1:PORT/api/v1/legacy');
    assert.equal(JSON.parse(res.body).message, 'legacy');
  });

  await test('接口文件不存在时放行 next()', async () => {
    const res = await request(viteMiddleware, 'http://127.0.0.1:PORT/api/v1/not-generated');
    assert.equal(res.status, 404);
    assert.equal(res.body, 'NEXT');
  });

  await test('非 baseURL 前缀直接放行', async () => {
    const res = await request(viteMiddleware, 'http://127.0.0.1:PORT/other/path');
    assert.equal(res.body, 'NEXT');
  });

  await test('baseURL 越界前缀不拦截（/api2）', async () => {
    const res = await request(viteMiddleware, 'http://127.0.0.1:PORT/api2/v1/legacy');
    assert.equal(res.body, 'NEXT');
  });

  // ------------------------------------------------------------ Webpack 插件
  console.log('\n[Webpack 插件链路]');

  await test('webpack-dev-server 3 注入 devServer.before', async () => {
    const beforeFn = () => {};
    const devServer = { before: beforeFn };
    const compiler = createCompiler(devServer);
    webpackMockServer({ include: MOCK_DIR, baseURL: '/api', enabled: true }).apply(compiler);
    compiler.run();

    assert.notEqual(devServer.before, beforeFn);
    assert.equal(devServer.setupMiddlewares, undefined);

    const stack = [];
    devServer.before({ use: fn => stack.push(fn) }, {}, compiler);
    const res = await request(stack[0], 'http://127.0.0.1:PORT/api/v1/legacy');
    assert.equal(JSON.parse(res.body).message, 'legacy');
  });

  await test('webpack-dev-server 4 注入 setupMiddlewares 且中间件在最前', async () => {
    const userMiddleware = { name: 'user', middleware: (req, res, next) => next() };
    const devServer = {
      setupMiddlewares: (middlewares) => {
        middlewares.push(userMiddleware);
        return middlewares;
      },
    };
    const compiler = createCompiler(devServer);
    webpackMockServer({ include: MOCK_DIR, baseURL: '/api', enabled: true }).apply(compiler);
    compiler.run();

    const result = devServer.setupMiddlewares([], {});
    assert.equal(result.length, 2);
    assert.equal(result[1], userMiddleware);

    const res = await request(result[0], 'http://127.0.0.1:PORT/api/v1/legacy');
    assert.equal(JSON.parse(res.body).message, 'legacy');
  });

  await test('配置中已存在 onBeforeSetupMiddleware 时同时包装注入', async () => {
    const originOnBefore = () => {};
    const devServer = { onBeforeSetupMiddleware: originOnBefore };
    const compiler = createCompiler(devServer);
    webpackMockServer({ include: MOCK_DIR, baseURL: '/api', enabled: true }).apply(compiler);
    compiler.run();

    assert.notEqual(devServer.onBeforeSetupMiddleware, originOnBefore);

    const stack = [];
    devServer.onBeforeSetupMiddleware({ app: { use: fn => stack.push(fn) } });
    const res = await request(stack[0], 'http://127.0.0.1:PORT/api/v1/legacy');
    assert.equal(JSON.parse(res.body).message, 'legacy');
  });

  await test('enabled:false 时不改写 devServer 配置', () => {
    const before = () => {};
    const devServer = { before };
    const compiler = createCompiler(devServer);
    webpackMockServer({ include: MOCK_DIR, baseURL: '/api', enabled: false }).apply(compiler);
    compiler.run();
    assert.equal(devServer.before, before);
  });

  // ------------------------------------------------------------------ CLI
  console.log('\n[CLI 参数]');

  await test('解析短参数与长参数', () => {
    const options = parseArgs([ '-i', './a.har', '-o', 'mock', '-b', '/api', '-w', '-y', '-d' ]);
    assert.equal(options.input, './a.har');
    assert.equal(options.output, 'mock');
    assert.equal(options.baseURL, '/api');
    assert.equal(options.overwrite, true);
    assert.equal(options.yes, true);
    assert.equal(options.debug, true);
  });

  await test('支持 --key=value 写法', () => {
    const options = parseArgs([ '--input=./a.har', '--output=gen', '--base-url=/v2' ]);
    assert.equal(options.input, './a.har');
    assert.equal(options.output, 'gen');
    assert.equal(options.baseURL, '/v2');
  });

  await test('未知参数抛出错误', () => {
    assert.throws(() => parseArgs([ '--nope' ]), /未知参数/);
  });

  await test('runCli --version 输出版本号', async () => {
    const { runCli } = await import('../dist/index.js');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const logs = [];
    const original = console.log;
    console.log = (message) => logs.push(message);
    try {
      await runCli([ '--version' ]);
    }
    finally {
      console.log = original;
    }
    assert.equal(logs.join(''), pkg.version);
  });

  await test('runCli --help 输出用法', async () => {
    const { runCli } = await import('../dist/index.js');
    const logs = [];
    const original = console.log;
    console.log = (message) => logs.push(message);
    try {
      await runCli([ '--help' ]);
    }
    finally {
      console.log = original;
    }
    const output = logs.join('\n');
    assert.match(output, /--input/);
    assert.match(output, /--overwrite/);
  });

  await test('runCli -y 全默认值生成接口文件', async () => {
    const { runCli } = await import('../dist/index.js');
    const logs = [];
    const original = console.log;
    console.log = (message) => logs.push(message);
    try {
      await runCli([ '-i', path.join(HAR_DIR, 'full.har'), '-o', 'tmp/cli-out', '-y' ]);
    }
    finally {
      console.log = original;
    }
    assert.deepEqual(listFiles(path.join(TMP, 'cli-out')), [
      'v1/base64.get',
      'v1/fetch-data.get',
      'v1/login.post',
      'v1/no-type.get',
      'v1/user.get',
    ]);
  });

  await test('runCli 缺少输入且禁用对话框时设置失败退出码', async () => {
    const { runCli } = await import('../dist/index.js');
    const original = process.exitCode;
    const originalError = console.error;
    console.error = () => {};
    try {
      await runCli([ '--no-dialog' ]);
      assert.equal(process.exitCode, 1);
    }
    finally {
      console.error = originalError;
      process.exitCode = original;
    }
  });

  await testProcess('bin/cli.js --version 进程级退出码为 0', async () => {
    const result = spawnSync(process.execPath, [ path.join(ROOT, 'bin', 'cli.js'), '--version' ], {
      encoding: 'utf8',
      cwd: ROOT,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.trim(), '');
    assert.match(result.stdout, /\d+\.\d+\.\d+/);
  });

  await testProcess('bin/cli.js 未知参数时退出码为 1', async () => {
    const result = spawnSync(process.execPath, [ path.join(ROOT, 'bin', 'cli.js'), '--nope' ], {
      encoding: 'utf8',
      cwd: ROOT,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /未知参数/);
  });

  await testProcess('bin/cli.js 非 TTY 下被中断时退出码为 0 且无告警', async () => {
    const result = spawnSync(
      process.execPath,
      [ path.join(ROOT, 'bin', 'cli.js'), '-i', path.join(HAR_DIR, 'full.har'), '-o', 'tmp/notty-out' ],
      { encoding: 'utf8', cwd: ROOT, input: '\n\n\n' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /unsettled top-level await/);
    assert.match(result.stdout, /已取消操作/);
  });

  // ------------------------------------------------------------------ 汇总
  const total = passed + failures.length + skipped;
  const summary = skipped > 0 ? `${passed}/${total} passed, ${skipped} skipped` : `${passed}/${total} passed`;
  console.log(`\n===== ${summary} =====`);

  if (failures.length > 0) {
    console.log('\n失败用例：');
    for (const { name, error } of failures) {
      console.log(`  - ${name}\n    ${error.stack?.split('\n')[0] ?? error.message}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
