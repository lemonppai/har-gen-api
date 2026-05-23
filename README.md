# har-to-api
> 浏览器HAR转成接口文件

## 使用

### 全局安装
```bash
npm install -g har-to-api
```

### 命令行使用
```bash
har-to-api --input mock/har.local --output mock/api.local --baseURL /api --overwrite
```

### 参数说明：
* input: 输入路径，默认为 mock/har.local (default: "mock/har.local")
* output: 输出路径，默认为 mock/api.local (default: "mock/api.local")
* baseURL: baseURL路径 (default: "")
* overwrite: 是否覆盖已存在的文件 (default: false)
