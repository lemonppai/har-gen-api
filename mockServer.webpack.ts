import chalk from 'chalk';
import { handleMockRequest, normalizeOptions, MockServerOptions } from './mockCore';

/**
 * 探测当前 devServer 配置是否支持 webpack-dev-server 4+ 的 `setupMiddlewares`。
 * 不做版本号依赖，直接按 source 特征判断，兼容函数被改写/包装的情况。
 */
const supportsSetupMiddlewares = (devServerConfig: any): boolean => {
  if (!devServerConfig) {
    return false;
  }

  return Object.getOwnPropertyNames(devServerConfig).some(key => {
    try {
      const value = (devServerConfig as any)[ key ];
      return typeof value === 'function' && String(value).includes('setupMiddlewares');
    }
    catch {
      return false;
    }
  });
};

export interface MockServerPlugin {
  name: string;
  apply(compiler: any): void;
}

/**
 * Webpack 插件 —— 兼容 webpack-dev-server 3 / 4 / 5
 *
 * wds 4+（vue-cli 4.5 + webpack 5 / vue-cli 5）走 `setupMiddlewares`，
 * wds 3（vue-cli 4.0 ~ 4.5 默认 webpack 4）走 `before`。
 *
 * 默认不主动改写 `onBeforeSetupMiddleware`：vue-cli 4.x 内部依赖它做
 * webpack / wds 版本校验，改写会触发 `invalid schema` 而启动失败。
 * 若当前配置里已经显式存在 `onBeforeSetupMiddleware`，两条链路同时注入，
 * 保证 wds 4 下（部分 vue-cli 4.5 配置）也能生效。
 */
export const mockServer = (options: MockServerOptions = {}): MockServerPlugin => {
  const opts = normalizeOptions(options);

  return {
    name: 'har-gen-api',

    apply(compiler: any) {
      if (!opts.enabled) {
        return;
      }

      compiler.hooks.afterEnvironment.tap(this.name, () => {
        const config: any = compiler.options?.devServer;

        if (!config) {
          console.warn(`${chalk.yellow('[har-gen-api]')} ${chalk.gray('未检测到 devServer 配置，Mock 服务未启用')}`);
          return;
        }

        const middleware = (req: any, res: any, next: Function) => {
          handleMockRequest(opts, req, res, next);
        };

        // ---- wds 4+ ----
        if (supportsSetupMiddlewares(config)) {
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
        // ---- wds 3 / wds 4 的 onBeforeSetupMiddleware 链路 ----
        else {
          const originBefore = config.before;

          config.before = (app: any, server: any, compilerInstance: any) => {
            if (typeof originBefore === 'function') {
              originBefore(app, server, compilerInstance);
            }
            app.use(middleware);
          };

          // wds 4 且配置里已存在 onBeforeSetupMiddleware 时，额外注入
          if (typeof config.onBeforeSetupMiddleware === 'function') {
            const originOnBefore = config.onBeforeSetupMiddleware;

            config.onBeforeSetupMiddleware = (devServer: any) => {
              originOnBefore(devServer);
              devServer.app.use(middleware);
            };
          }
        }

        console.log(`${chalk.cyan.bold('[har-gen-api]')} ${chalk.green(`Mock server is running... (${opts.baseURL} -> ${opts.include})`)}`);
      });
    },
  };
};

export type { MockServerOptions };
