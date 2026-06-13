import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';
import { program } from 'commander';

// 解析命令行参数
program
  .option('-i, --input <path>', '输入路径，默认为 mock/har', 'mock/har')
  .option('-o, --output <path>', '输出路径，默认为 mock', 'mock')
  // baseURL路径
  .option('-b, --baseURL <path>', 'baseURL路径', '')
  .option('-w, --overwrite', '是否覆盖已存在的文件', false)
  .parse(process.argv);

program.parse();

const { input, output, overwrite, baseURL } = program.opts();
const generate = () => {
  console.log('输入路径：', input);
  console.log('输出路径：', output);
  console.log('baseURL路径：', baseURL);
  console.log('是否覆盖已存在的文件：', overwrite);

  let count = 0;

  if (!fs.existsSync(input)) {
    // console.error(`File not found: ${input}`);
    console.error(`文件或目录不存在：${input}`);
    process.exit(1);
  }

  // 判断 input 是文件还是目录
  if (fs.statSync(input).isFile()) {
    // 如果是文件，直接处理该文件
    if (input.endsWith('.har')) {
      count += processHarFile(input);
    }
  }
  else {
    fs.readdirSync(input).forEach(file => {
      if (file.endsWith('.har')) {
        const filePath = path.join(input, file);
        count += processHarFile(filePath);
      }
    });
  }

  console.log('生成了', count, '条 mock 数据');
}

const processHarFile = (filePath) => {
  let count = 0;

  let data = fs.readFileSync(filePath, 'utf-8');

  data = JSON.parse(data);
  if (!data.log || !data.log.entries) {
    console.error('Invalid HAR file format');
    return;
  }

  data.log.entries.forEach(item => {
    // 只处理XHR请求和200响应，响应内容类型为application/json的请求
    if (item._resourceType == 'xhr' && item.response.status == 200 && item.response.headers.some(item => item.name.toLowerCase() == 'content-type' && item.value.includes('application/json'))) {
      const urlObj = new URL(item.request.url);
      // console.log(url)
      const url = urlObj.pathname.replace(baseURL, '');
      const method = item.request.method.toLowerCase();
      let resData = {
        [urlObj.search]: item.response.content.text
      };

      const filePath = path.join(output, `${url}.${method}`);

      if (fs.existsSync(filePath)) {
        let d = fs.readFileSync(filePath, 'utf-8');
        d = JSON5.parse(d);

        if (Object.keys(d).some(key => !key.startsWith('?') && key !== '')) {
          d = {
            '': JSON.stringify(d)
          };
        }

        if (!overwrite && d.hasOwnProperty(url.search)) {
          console.log(`已存在相同的路径: ${url.pathname}${url.search}`);
          return;
        }

        resData = Object.assign(d, resData);
      }

      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      fs.writeFileSync(filePath, JSON5.stringify(resData, null, 2));

      count++;
    }
  });

  return count;
}

export { generate };
