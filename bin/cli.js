#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cfonts from 'cfonts';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'dist', 'index.js');

if (!fs.existsSync(entry)) {
  console.error('未找到构建产物 dist/index.js，请先在包目录执行 `npm run build`。');
  process.exit(1);
}

cfonts.say('Har Gen Api', {
  font: 'simple',
  space: false,
});

/**
 * 处理异常并设置退出码。
 *
 * 不使用顶层 await：inquirer 的 prompt 在被中断（Ctrl+C / 非 TTY）时会留下
 * 内部 pending promise，Node 会因此报 "unsettled top-level await" 并以 13 退出。
 */
const handleError = (error) => {
  const name = error?.name;

  // 交互被 Ctrl+C / Esc 中断，或非 TTY 环境（管道、CI）无法应答，按正常退出处理
  if (name === 'ExitPromptError' || name === 'AbortPromptError') {
    console.log('已取消操作');
    process.exitCode = 0;
    return;
  }

  console.error(`发生错误：${error?.message ?? error}`);
  process.exitCode = 1;
};

// Windows 下动态 import 必须使用 file:// URL
import(pathToFileURL(entry).href)
  .then(({ runCli }) => runCli(process.argv.slice(2)))
  .catch(handleError);
