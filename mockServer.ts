import Mock from 'mockjs';
import fs from 'fs';
import _ from 'lodash';
import JSON5 from 'json5';
import chalk from 'chalk';

export const mockServer = ({
  include = 'mock',
  baseURL = '',
  enabled = false,
  debug = false
} = {}) => {
  return {
    name: 'mock-server',
    configureServer(server: any) {
      if (enabled) {
        server.middlewares.use((req: any, res: any, next: Function) => {
          const url: URL = new URL(req.url, `http://${req.headers.host}`);
          let pathname: string = url.pathname;

          if (pathname.startsWith(baseURL)) {
            pathname = pathname.replace(new RegExp(`^${baseURL}`), '');
            const filePath: string = `${include}/${pathname}.${req.method.toLowerCase()}`.replace(/\/+/g, '/');

            if (debug) {
              console.log(`${chalk.cyan.bold('[har-gen-api]')} ${chalk.blue.bold(`[${req.method}]`)} ${chalk.gray(url.pathname)}`);
            }

            fs.readFile(filePath, (err: NodeJS.ErrnoException | null, fileData: Buffer) => {
              if (err) {
                next();
                return;
              }

              res.setHeader('X-Powered-By', 'mockjs');
              res.setHeader('Content-Type', 'application/json; charset=utf-8');

              try {
                let data: Record<string, any> = JSON5.parse(fileData.toString());
                const keys = Object.keys(data).filter(key => key.startsWith('?') || key === '');

                keys.sort((a, b) => {
                  return a > b ? 1 : -1;
                });

                data = data[ url.search ] ?? data[ keys[0] ] ?? data;

                if (_.isString(data)) {
                  // 模板解析
                  const dataStr: string = _.template(data)({
                    headers: req.headers,
                    query: req.query,
                    body: req.body,
                  });

                  data = dataStr ? JSON.parse(dataStr) : null;
                }

                data = Mock.mock(data);

                // res.send(data);
                res.end(JSON.stringify(data));
              }
              catch (e) {
                console.error(e);
                // res.status(500).send('Mock Error');
                // res.send(500, 'Mock Error');
                res.statusCode = 500;
                res.end('Mock Error');
              }
            });
          }
          else {
            next();
          }
        });

        console.log(`${chalk.cyan.bold('[har-gen-api]')} ${chalk.green('Mock server is running...')}`);
      }
    },
  };
};
