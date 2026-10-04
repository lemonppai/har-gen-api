export interface MockServerOptions {
  /** 存放接口文件的目录（相对于项目根目录） */
  include?: string;
  /** 需要 Mock 的接口基础路径 */
  baseURL?: string;
  /** 是否启用 Mock 服务 */
  enabled?: boolean;
  /** 开启后控制台会打印每个被拦截的请求方法和路径 */
  debug?: boolean;
}

export interface MockServerPlugin {
  name: string;
  apply(compiler: any): void;
}

/**
 * Webpack 插件，兼容 webpack-dev-server 3 / 4 / 5（Vue CLI 4.0+）
 *
 * @example
 * // vue.config.js
 * const { mockServer } = require('har-gen-api/webpack')
 * module.exports = {
 *   configureWebpack: {
 *     plugins: [ mockServer({ include: 'mock', baseURL: '/api', enabled: true }) ]
 *   }
 * }
 */
export declare const mockServer: (options?: MockServerOptions) => MockServerPlugin;

export type { MockServerPlugin as MockServerWebpackPlugin };
