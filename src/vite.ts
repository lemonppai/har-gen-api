import { handleMockRequest, normalizeOptions } from './core/mockRuntime';
import type { MockServerOptions } from './core/types';
import { logger } from './ui/logger';

export interface ViteMockServerPlugin {
  name: string;
  configureServer(server: any): void;
}

/**
 * Vite 插件：开发环境下拦截 `baseURL` 前缀的请求并返回 Mock 数据。
 *
 * @example
 * // vite.config.ts
 * import { mockServer } from 'har-gen-api/vite'
 * export default defineConfig({
 *   plugins: [ mockServer({ include: 'mock', baseURL: '/api', enabled: true }) ]
 * })
 */
export const mockServer = (options: MockServerOptions = {}): ViteMockServerPlugin => {
  const normalized = normalizeOptions(options);

  return {
    name: 'mock-server',

    configureServer(server: any) {
      if (!normalized.enabled) {
        return;
      }

      server.middlewares.use((req: any, res: any, next: Function) => {
        handleMockRequest(normalized, req, res, next);
      });

      logger.info(logger.accent(`Mock server is running... (${normalized.baseURL || '/'} -> ${normalized.include})`));
    },
  };
};

export type { MockServerOptions };
