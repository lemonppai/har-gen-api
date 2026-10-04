import chalk from 'chalk';
import { handleMockRequest, normalizeOptions, MockServerOptions } from './mockCore';

export const mockServer = (options: MockServerOptions = {}) => {
  const opts = normalizeOptions(options);

  return {
    name: 'mock-server',
    configureServer(server: any) {
      if (!opts.enabled) {
        return;
      }

      server.middlewares.use((req: any, res: any, next: Function) => {
        handleMockRequest(opts, req, res, next);
      });

      console.log(`${chalk.cyan.bold('[har-gen-api]')} ${chalk.green('Mock server is running...')}`);
    },
  };
};

export type { MockServerOptions };
