/**
 * 兼容性验证：node scripts/verify-webpack.cjs
 *  A. webpack-dev-server 3 (vue-cli 4.0~4.5 默认)  -> 注入 devServer.before
 *  B. webpack-dev-server 4 (vue-cli 5 / 4.5+wp5)   -> 注入 setupMiddlewares
 *  C. enabled:false 不改写配置
 */
const path = require('path');
const http = require('http');

const { mockServer } = require(path.resolve(__dirname, '../dist/mockServer.webpack.cjs'));

const createCompiler = (devServer) => {
  const hooks = {};
  return {
    options: { devServer },
    hooks: {
      afterEnvironment: { tap: (name, fn) => (hooks.afterEnvironment = fn) },
    },
    __run: () => {
      hooks.afterEnvironment?.();
    },
  };
};

const request = (middleware, url) =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      middleware(req, res, () => {
        res.statusCode = 404;
        res.end('NEXT');
      });
    });
    server.listen(0, () => {
      const port = server.address().port;
      const target = url.replace('http://localhost:0', `http://localhost:${port}`);
      http.get(target, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body });
        });
      });
    });
  });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ' -> ' + detail : ''}`);
};

(async () => {
  // ---------- A. wds 3 ----------
  console.log('\n[A] webpack-dev-server 3 (vue-cli 4.0~4.5 默认)');
  {
    const beforeFn = function before() { /* 用户已有配置 */ };
    const devServer = { before: beforeFn };
    const compiler = createCompiler(devServer);

    mockServer({ include: 'mock', baseURL: '/api', enabled: true }).apply(compiler);
    compiler.__run();

    check('注入 devServer.before（不新增 setupMiddlewares）', typeof devServer.before === 'function' && devServer.before !== beforeFn && !devServer.setupMiddlewares);

    const stack = [];
    devServer.before({ use: (m) => stack.push(m) }, {}, compiler);
    check('原有 before 回调被保留并追加中间件', stack.length === 1);

    const r1 = await request(stack[0], 'http://localhost:0/api/v1/auth/intl');
    check('GET 命中 mock 文件返回 200', r1.status === 200 && r1.body.includes('"code":200'), r1.body.slice(0, 60));

    const r2 = await request(stack[0], 'http://localhost:0/api/not-exist');
    check('未命中时放行 next()', r2.status === 404 && r2.body === 'NEXT');

    const r3 = await request(stack[0], 'http://localhost:0/other/path');
    check('非 baseURL 前缀直接放行', r3.status === 404 && r3.body === 'NEXT');
  }

  // ---------- B. wds 4 ----------
  console.log('\n[B] webpack-dev-server 4 (vue-cli 5 / 4.5+webpack5)');
  {
    const setupMiddlewares = function setupMiddlewares(middlewares) {
      middlewares.push({ name: 'user-mw', middleware: (req, res, next) => next() });
      return middlewares;
    };
    const devServer = { setupMiddlewares, onBeforeSetupMiddleware: function () {} };
    const compiler = createCompiler(devServer);

    mockServer({ include: 'mock', baseURL: '/api', enabled: true }).apply(compiler);
    compiler.__run();

    const middlewares = [];
    const returned = devServer.setupMiddlewares(middlewares, {});
    check('setupMiddlewares 被包装并返回数组', Array.isArray(returned) && returned.length === 2, `len=${returned.length}`);

    const r1 = await request(returned[0], 'http://localhost:0/api/v1/containers/docker/status');
    check('wds4 链路 GET 命中', r1.status === 200, r1.body.slice(0, 60));

    check('onBeforeSetupMiddleware 同时被包装注入', typeof devServer.onBeforeSetupMiddleware === 'function');
  }

  // ---------- C. 关闭开关 ----------
  console.log('\n[C] enabled: false');
  {
    const devServer = { before: () => {} };
    const compiler = createCompiler(devServer);
    const original = devServer.before;
    mockServer({ include: 'mock', baseURL: '/api', enabled: false }).apply(compiler);
    compiler.__run();
    check('禁用时不改写 devServer 配置', devServer.before === original && !devServer.setupMiddlewares);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
  if (failed.length) process.exit(1);
})();
