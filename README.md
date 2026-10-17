# har-gen-api

基于浏览器 `.har` 文件自动生成前端 Mock 接口文件的工具。
提供 **CLI 命令**、**Vite 插件** 与 **Webpack 插件（兼容 Vue CLI 4.0+）**，把线上真实接口一键变成本地 Mock 数据，无需手写重复的响应体。

---

## 特性

- 🚀 从 Chrome / Edge / Firefox 导出的 `.har` 文件中提取请求与响应数据
- 📦 接口文件路径即接口路径 + 请求方式，如 `mock/v1/user.get`
- 🎯 按 query 分支管理同一接口的多种响应（`?page=1` / `?page=2`）
- 🧩 内置 Vite 插件与 Webpack 插件，开发环境实时拦截并返回 Mock 数据
- 🎨 支持 lodash template 注入 `query` / `body` / `headers`，以及 mockjs 模板语法
- 🔧 全命令行参数化，可在 CI / 脚本中使用（`-y` 全自动）
- 🔍 Debug 模式打印每个命中 / 写入的接口

---

## 安装

```bash
npm install har-gen-api --save-dev
# 或
yarn add har-gen-api --dev
```

要求 Node.js >= 18.18。

---

## 使用

### 1️⃣ 导出 HAR 文件

1. 打开 Chrome，按 **F12** 进入开发者工具
2. 切换到 **Network** 面板，刷新页面或操作你的应用
3. 右键任意请求 → **Save all as HAR with content**，保存为 `.har` 文件

> 💡 确保 HAR 中包含完整的请求 URL、方法、请求头与响应体。仅 **HTTP 200 且响应为 JSON** 的接口会被提取。

### 2️⃣ 生成 Mock 接口文件

```bash
npx har-gen-api
```

不带参数时进入交互流程：弹出系统文件选择框 → 依次确认生成路径、baseURL、是否覆盖。

也可以全参数化执行：

```bash
npx har-gen-api -i ./api.har -o mock -b /api -w
```

#### CLI 参数

| 参数 | 说明 |
| ---- | ---- |
| `-i, --input <path>` | HAR 文件或包含 `.har` 的目录（缺省弹出文件选择框） |
| `-o, --output <dir>` | 生成目录（默认 `mock`） |
| `-b, --base-url <path>` | 接口基础路径（默认 `/api`） |
| `-w, --overwrite` | 覆盖相同请求参数的接口 |
| `-y, --yes` | 全部使用默认值，跳过交互 |
| `--no-dialog` | 禁用系统文件选择对话框（无 `-i` 时直接退出） |
| `-d, --debug` | 打印每个生成 / 跳过的接口 |
| `-h, --help` | 显示帮助 |
| `-v, --version` | 显示版本号 |

生成的目录结构示例：

```
mock/
└── v1/
    ├── user.get
    └── login.post
```

### 3️⃣ 集成到 Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { mockServer } from 'har-gen-api/vite'

export default defineConfig({
  plugins: [
    mockServer({
      include: 'mock',   // 存放接口文件的目录
      baseURL: '/api',   // 需要拦截的接口前缀
      enabled: true,     // 是否启用
      debug: true        // 是否打印请求日志
    })
  ]
})
```

### 4️⃣ 集成到 Webpack / Vue CLI 4.0+

Vue CLI 项目（`vue.config.js`）：

```js
const { mockServer } = require('har-gen-api/webpack')

module.exports = {
  configureWebpack: {
    plugins: [
      mockServer({ include: 'mock', baseURL: '/api', enabled: true, debug: true })
    ]
  }
}
```

原生 Webpack 项目同理，把插件加入 `plugins` 数组即可。

#### 版本兼容说明

插件根据项目内 `webpack-dev-server` 的实际版本自动选择注入方式，两种方式都不覆盖你已有的配置：

| 构建环境 | webpack-dev-server | 注入方式 |
| -------- | ------------------ | -------- |
| Vue CLI 4.0 ~ 4.5（webpack 4） | v3 | `devServer.before` |
| Vue CLI 4.5 + webpack 5 / Vue CLI 5 | v4+ | `devServer.setupMiddlewares` |

> 💡 Mock 中间件插入在中间件链**最前面**，优先于 `historyApiFallback`、`proxy`，不会被 SPA 路由回退吞掉。
>
> 💡 不会主动新增 `onBeforeSetupMiddleware`：Vue CLI 4.x 内部依赖它做版本校验，新增会触发 `invalid schema` 启动失败；仅在配置中已存在该钩子时才包装注入。

#### 插件参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `include` | `string` | `'mock'` | 存放接口文件的目录（相对于项目根目录） |
| `baseURL` | `string` | `''` | 需要 Mock 的接口基础路径，留空表示全部拦截 |
| `enabled` | `boolean` | `false` | 是否启用 Mock 服务 |
| `debug` | `boolean` | `false` | 打印每个被拦截的请求方法和路径 |

---

## 接口文件格式

文件扩展名为 `.get` / `.post`，对应请求方式。**文件名即路径**：`mock/v1/user.get` 对应 `baseURL + /v1/user` 的 GET 请求。

内容为 JSON5，key 是 query 串：

```json5
{
  // 兜底响应：query 未命中任何分支时使用
  '': '{"code":200,"data":{"page":"default"}}',
  '?page=1': '{"code":200,"data":{"page":1}}',
  '?page=2': '{"code":200,"data":{"page":2}}'
}
```

取值优先级：`query` 精确匹配 → `''` 或 `?` 开头的兜底键 → 整个对象作为响应数据。

### 动态数据

字符串值会先经 **lodash template** 渲染，再交给 **mockjs** 解析：

```json5
{
  '': '{"code":200,"name":"<%= query.name %>","id":"@integer(1,1000)"}'
}
```

- lodash template 可访问 `query`、`body`、`headers`
- mockjs 模板语法（`@integer`、`@cname`、`@image` 等）在渲染后生效

### 旧格式兼容

历史生成的「单对象」格式（无 query 键）仍可直接使用；当同一路径存在新接口写入时，会被自动包装到 `''` 键下统一管理。

---

## 开发

```bash
npm run build       # 构建 dist（esbuild 打包 + tsc 生成 d.ts）
npm run typecheck   # 类型检查
npm test            # 端到端测试（需先 build）
npm start           # 本地运行 CLI
```

### 目录结构

```
src/
├── core/            # 纯逻辑，无交互、无日志，可独立测试
│   ├── types.ts         # 类型定义
│   ├── paths.ts         # baseURL 匹配与路径拼接
│   ├── har.ts           # HAR 解析与接口文件生成
│   └── mockRuntime.ts   # 请求拦截与响应渲染
├── ui/              # 交互与输出
│   ├── logger.ts        # 统一日志
│   ├── dialog.ts        # 跨平台文件选择对话框
│   └── ask.ts           # 交互式提问
├── cli.ts           # CLI 参数解析与主流程
├── index.ts         # 公共 API 导出
├── vite.ts          # Vite 插件
└── webpack.ts       # Webpack 插件
```

---

## License

MIT
