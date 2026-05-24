// mock/index.js
const Mock = require('mockjs');
const fs = require('fs');
const _ = require('lodash');
const JSON5 = require('json5');

const mockServer = ({ mockPath = 'mock', baseURL = '', enabled = false } = {}) => {
  return {
    name: 'mock-server',
    configureServer(server) {
      if (localEnabled) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url, `http://${req.headers.host}`);
          let pathname = url.pathname;

          if (pathname.startsWith(baseURL)) {
            pathname = pathname.replace(new RegExp(`^${baseURL}`), '');

            // console.log('路径', pathname);

            // console.log(`${mockPath}${pathname}.${req.method.toLowerCase()}`)

            fs.readFile(`${mockPath}${pathname}.${req.method.toLowerCase()}`, (err, data) => {
              if (err) {
                next();
                return;
              }

              res.setHeader('X-Powered-By', 'mockjs');
              res.setHeader('Content-Type', 'application/json; charset=utf-8');

              try {
                data = JSON5.parse(data);
                const keys = Object.keys(data).filter(key => key.startsWith('?') || key === '');

                keys.sort((a, b) => {
                  return a > b ? 1 : -1;
                });

                data = data[ url.search ] ?? data[ keys[0] ] ?? data;

                if (_.isString(data)) {
                  // 模板解析
                  data = _.template(data)({
                    headers: req.headers,
                    query: req.query,
                    body: req.body,
                  });

                  data = JSON.parse(data || null);
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

        console.log('Mock server is running...');
      }
    },
  };
};

exports.mockServer = mockServer;
