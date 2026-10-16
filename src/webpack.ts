import fs from 'node:fs';
import path from 'node:path';
// 别名导入：构建产物顶部会注入同名 shim，直接用原名会重复声明
import { createRequire as createNodeRequire } from 'node:module';
import { handleMockRequest, normalizeOptions } from './core/mockRuntime';
import type { MockServerOptions } from './core/types';
import { logger } from './ui/logger';

export interface WebpackMockServerPlugin {
  name: string;
  apply(compiler: any): void;
}

/** 解析项目内 webpack-dev-server 的大版本号；无法确定时返回 null */
const detectDevServerMajor = (): number | null => {
  try {
    const projectRequire = createNodeRequire(path.join(process.cwd(), 'package.json'));
    const pkgPath = projectRequire.resolve('webpack-dev-server/package.json');
    const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const major = Number.parseInt(String(version), 10);

    return Number.isNaN(major) ? null : major;
  }
  catch {
    return null;
  }
};

/** devServer 配置上是否已出现 webpack-dev-server 4+ 专有选项 */
const hasDevServerV4Options = (devServerConfig: any): boolean => {
  if (!devServerConfig) {
    return false;
  }

  return [ 'setupMiddlewares', 'onBeforeSetupMiddleware', 'onAfterSetupMiddleware' ].some(key =>
    Object.prototype.hasOwnProperty.call(devServerConfig, key)
  );
};

/**
 * 判定当前应使用哪套注入方式。
 *
 * 优先读取项目内 `webpack-dev-server` 的真实版本（vue-cli 4.0~4.5 默认 wds 3，
 * vue-cli 4.5+/5 为 wds 4+），读不到时退回按 devServer 配置特征判断，
 * 避免依赖「函数源码是否含某字符串」这类脆弱信号。
 */
const resolveDevServerAPI = (devServerConfig: any): 'setupMiddlewares' | 'before' => {
  const major = detectDevServerMajor();

  if (major !== null) {
    return major >= 4 ? 'setupMiddlewares' : 'before';
  }

  return hasDevServerV4Options(devServerConfig) ? 'setupMiddlewares' : 'before';
};

/**
 * Webpack 插件 —— 兼容 vue-cli 4.0+（webpack-dev-server 3 / 4 / 5）
 *
 * - wds 3（vue-cli 4.0 ~ 4.5 默认 webpack 4）注入 `devServer.before`
 * - wds 4+（vue-cli 4.5 + webpack 5 / vue-cli 5）注入 `devServer.setupMiddlewares`
 *
 * 默认不改写 `onBeforeSetupMiddleware`：vue-cli 4.x 内部依赖它做版本校验，
 * 改写会触发 `invalid schema` 导致启动失败；仅当配置中已存在该钩子时同时包装注入，
 * 以覆盖部分把该钩子写进配置的 vue-cli 4.5 场景。
 *
 * @example
 * // vue.config.js
 * const { mockServer } = require('har-gen-api/webpack')
 * module.exports = {
 *   configureWebpack: { plugins: [ mockServer({ include: 'mock', baseURL: '/api', enabled: true }) ] }
 * }
 */
export const mockServer = (options: MockServerOptions = {}): WebpackMockServerPlugin => {
  const normalized = normalizeOptions(options);

  return {
    name: 'har-gen-api',

    apply(compiler: any) {
      if (!normalized.enabled) {
        return;
      }

      compiler.hooks.afterEnvironment.tap('har-gen-api', () => {
        const config: any = compiler.options?.devServer;

        if (!config) {
          logger.warn('未检测到 devServer 配置，Mock 服务未启用');
          return;
        }

        const middleware = (req: any, res: any, next: Function) => {
          handleMockRequest(normalized, req, res, next);
        };

        if (resolveDevServerAPI(config) === 'setupMiddlewares') {
          const originSetupMiddlewares = config.setupMiddlewares;

          config.setupMiddlewares = (middlewares: any[], devServer: any) => {
            const result = typeof originSetupMiddlewares === 'function'
              ? originSetupMiddlewares(middlewares, devServer)
              : middlewares;

            const list = Array.isArray(result) ? result : middlewares;
            list.unshift(middleware);
            return list;
          };
        }
        else {
          const originBefore = config.before;

          config.before = (app: any, server: any, compilerInstance: any) => {
            if (typeof originBefore === 'function') {
              originBefore(app, server, compilerInstance);
            }
            app.use(middleware);
          };
        }

        // 仅当配置里已存在该钩子时才包装（不主动新增，避免 vue-cli 4.x 的
        // webpack/wds 版本校验报 invalid schema）。命中任一链路即可生效，
        // 重复注册无副作用：首个命中的中间件会直接结束响应。
        if (typeof config.onBeforeSetupMiddleware === 'function') {
          const originOnBefore = config.onBeforeSetupMiddleware;

          config.onBeforeSetupMiddleware = (devServer: any) => {
            originOnBefore(devServer);
            devServer.app.use(middleware);
          };
        }

        logger.info(logger.accent(`Mock server is running... (${normalized.baseURL || '/'} -> ${normalized.include})`));
      });
    },
  };
};

export type { MockServerOptions };
