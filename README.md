# har-gen-api

浏览器导出.har文件，生成自定义的接口文件。vite插件的形式，启动mock服务读取生成的接口文件。

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

### 命令行使用
```bash
# 生成接口文件
npx har-gen-api
```

命令行交互
1. 选择 HAR 文件
2. 输入生成的接口文件目录，默认：`mock`
3. 输入baseURL路径，默认：`/api`
4. 是否覆盖已存在的文件

### vite配置
```js
import { mockServer } from 'har-gen-api/vite';

export default defineConfig({
  plugins: [
    mockServer({
      include: 'mock',
      baseURL: '/api',
      enabled: true,
      debug: true
    })
  ]
})
```

#### 参数说明
* include: 匹配路径
* baseURL: 接口baseURL路径
* enabled: 是否启用
* debug: 是否打印接口日志
