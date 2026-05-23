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

参数说明：
* input: 输入HAR文件路径
* output: 输出接口文件路径
* baseURL: 接口基础URL
* overwrite: 是否覆盖已存在的接口文件
