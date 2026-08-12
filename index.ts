import os from 'os';
import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';

/**
 * 选择文件
 */
const selectFile = (): string | void => {
  const platform = os.platform();
  let command;

  switch (platform) {
    case 'win32': // Windows
      command = `powershell.exe -NoProfile -NonInteractive -Command "& {Add-Type -AssemblyName System.Windows.Forms; $FileDialog = New-Object System.Windows.Forms.OpenFileDialog; $FileDialog.Filter = 'HAR 文件 (*.har)|*.har|所有文件 (*.*)|*.*'; $FileDialog.Title = '请选择 HAR 文件'; $result = $FileDialog.ShowDialog(); if ($result -eq 'OK') { Write-Output $FileDialog.FileName }}"`;
      break;

    case 'darwin': // macOS
      command = `osascript -e 'tell application "System Events" to set harFile to choose file with prompt "请选择 HAR 文件" of type {"har", "public.data"} as alias' -e 'set thePath to POSIX path of harFile' -e 'return thePath'`;
      break;

    case 'linux': // Linux
      // 优先使用 zenity，若不存在可降级到 kdialog 或 xdg-open（但 xdg-open 不能返回路径）
      command = `zenity --file-selection --title="请选择 HAR 文件" --file-filter="HAR 文件 *.har" 2>/dev/null || kdialog --getopenfilename . "*.har" --title "请选择 HAR 文件" 2>/dev/null`;
      break;

    default:
      console.error(`${chalk.red('✖')} 不支持的操作系统: ${platform}`);
      return;
  }

  try {
    const filePath = execSync(command, { encoding: 'utf8' }).trim();
    return filePath;
  } catch (err) {
    console.error(`${chalk.red('✖')} 未选择文件或出错:`, err);
  }
};

const generate = async (): Promise<void> => {
  const input = selectFile();

  if (!input) {
    console.log(`${chalk.yellow('⚠')} 未选择文件`);
    return;
  }

  console.log(`${chalk.green('✔')} HAR 文件路径 ${chalk.cyan(input)}`);

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
    console.error(`${chalk.red('✖')} 文件或目录不存在：${input}`);
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

  console.log(`生成了 ${chalk.green(count)} 条 ${chalk.blue.bold('mock')} 数据`);
}

const processHarFile = (filePath: string, output: string, baseURL: string, overwrite: boolean): number => {
  let count = 0;

  const fileStr: string = fs.readFileSync(filePath, 'utf-8');
  const data: any = JSON.parse(fileStr);

  if (!data.log || !data.log.entries) {
    console.error(`${chalk.red('✖')} Invalid HAR file format`);
    return 0;
  }

  data.log.entries.forEach((item: any) => {
    // 只处理XHR请求和200响应，响应内容类型为application/json的请求
    if (item._resourceType == 'xhr' && item.response.status == 200 && item.response.headers.some((item: any) => item.name.toLowerCase() == 'content-type' && item.value.includes('application/json'))) {
      const urlObj: URL = new URL(item.request.url);
      // console.log(url)
      const url: string = urlObj.pathname.replace(new RegExp(`^${baseURL}`), '');
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
          console.log(`${chalk.yellow('⚠')} 已存在相同的路径 ${chalk.gray(urlObj.pathname + urlObj.search)}`);
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
