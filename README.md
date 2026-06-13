# har-gen-api

> 浏览器har文件转成自定义的接口文件，通过 **vite** 启动 **mock** 服务，实现接口模拟

## 使用

### 安装
```bash
npm install har-gen-api
# or
yarn add har-gen-api
```

### 导出har文件
1. 打开浏览器`chrome`
2. 打开 **F12** 切换到`Network`
3. 点击导出按钮，选择保存路径
4. 保存 **har** 文件到 `mock/har` 文件夹下

### 命令行使用
```bash
npx har-gen-api --input mock/har --output mock --baseURL /api --overwrite
```

#### 参数说明
* input: 输入路径，默认为 `mock/har` (default: "mock/har.local")
* output: 输出路径，默认为 `mock` (default: "mock/api.local")
* baseURL: baseURL路径，注意 **windows** 系统需要前面多加`/`，如`//api` (default: "")
* overwrite: 是否覆盖已存在的文件 (default: false)

### vite配置
```js
import { mockServer } from 'har-gen-api/vite';

export default defineConfig({
  plugins: [
    mockServer({
      include: 'mock',
      baseURL: '/api',
      enabled: true
    })
  ]
})
```

#### 参数说明
* include: 匹配路径
* baseURL: 接口baseURL路径
* enabled: 是否启用
