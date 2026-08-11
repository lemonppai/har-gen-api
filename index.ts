import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';
import { program } from 'commander';
import { execSync } from 'child_process';
import inquirer from 'inquirer';

// 解析命令行参数
/* program
  .option('-i, --input <path>', '输入路径，默认为 mock/har', 'mock/har')
  .option('-o, --output <path>', '输出路径，默认为 mock', 'mock')
  // baseURL路径
  .option('-b, --baseURL <path>', 'baseURL路径', '')
  .option('-w, --overwrite', '是否覆盖已存在的文件', false)
  .parse(process.argv);

program.parse();

const { input, output, overwrite, baseURL } = program.opts(); */

/**
 * 选择文件
 */
const selectFile = (): string | void => {
  const command = `powershell.exe -NoProfile -NonInteractive -Command "& {Add-Type -AssemblyName System.Windows.Forms; $FileDialog = New-Object System.Windows.Forms.OpenFileDialog; $FileDialog.Filter = 'HAR 文件 (*.har)|*.har|所有文件 (*.*)|*.*'; $FileDialog.Title = '请选择 HAR 文件'; $result = $FileDialog.ShowDialog(); if ($result -eq 'OK') { Write-Output $FileDialog.FileName }}"`;

  try {
    const filePath = execSync(command, { encoding: 'utf8' }).trim();
    return filePath;
  } catch (err) {
    console.error('未选择文件或出错:', err);
  }
};

const generate = async (): Promise<void> => {
  // console.log('输入路径：', input);
  // console.log('输出路径：', output);
  // console.log('baseURL路径：', baseURL);
  // console.log('是否覆盖已存在的文件：', overwrite);

  const input = selectFile();

  if (!input) {
    console.log('未选择文件');
    return;
  }

  if (!input.endsWith('.har')) {
    console.error('请选择 HAR 文件');
    return;
  }

  console.log('HAR 文件路径:', input);

  const { output, baseURL, overwrite } = await inquirer.prompt([
    {
      type: 'input',
      name: 'output',
      message: '生成路径',
      default: 'mock',
      validate(s: string) {
        if (/^(?!\/)[^\0]+$/.test(s.trim())) {
          return true;
        }
        return '格式不正确';
      }
    },
    {
      type: 'input',
      name: 'baseURL',
      message: 'baseURL路径',
      default: '/api',
      validate(s: string) {
        if (/^\/[^\0]+$/.test(s.trim())) {
          return true;
        }
        return '格式不正确';
      }
    },
    {
      type: 'select',
      name: 'overwrite',
      message: '是否覆盖已存在的文件',
      choices: [
        { name: '是', value: true },
        { name: '否', value: false }
      ],
    },
  ]);

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
      count += processHarFile(input, output, baseURL, overwrite);
    }
  }
  else {
    fs.readdirSync(input).forEach(file => {
      if (file.endsWith('.har')) {
        const filePath = path.join(input, file);
        count += processHarFile(filePath, output, baseURL, overwrite);
      }
    });
  }

  console.log('生成了', count, '条 mock 数据');
}

const processHarFile = (filePath: string, output: string, baseURL: string, overwrite: boolean): number => {
  let count = 0;

  const fileStr: string = fs.readFileSync(filePath, 'utf-8');
  const data: any = JSON.parse(fileStr);

  if (!data.log || !data.log.entries) {
    console.error('Invalid HAR file format');
    return 0;
  }

  data.log.entries.forEach((item: any) => {
    // 只处理XHR请求和200响应，响应内容类型为application/json的请求
    if (item._resourceType == 'xhr' && item.response.status == 200 && item.response.headers.some((item: any) => item.name.toLowerCase() == 'content-type' && item.value.includes('application/json'))) {
      const urlObj: URL = new URL(item.request.url);
      // console.log(url)
      const url: string = urlObj.pathname.replace(baseURL, '');
      const method: string = item.request.method.toLowerCase();
      let resData = {
        [urlObj.search]: item.response.content.text
      };

      const filePath = path.join(output, `${url}.${method}`);

      if (fs.existsSync(filePath)) {
        const fileStr = fs.readFileSync(filePath, 'utf-8');
        let d = JSON5.parse(fileStr);

        if (Object.keys(d).some(key => !key.startsWith('?') && key !== '')) {
          d = {
            '': JSON.stringify(d)
          };
        }

        if (!overwrite && d.hasOwnProperty(urlObj.search)) {
          console.log(`已存在相同的路径: ${urlObj.pathname}${urlObj.search}`);
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

// 判断是否为主模块
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  generate();
}
