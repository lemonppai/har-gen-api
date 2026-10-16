import { spawn } from 'node:child_process';
import os from 'node:os';

/**
 * 用系统文件管理器打开目录。
 *
 * 命令以独立进程启动，不阻塞也不随 CLI 退出而关闭。
 *
 * @returns 是否成功发起打开动作
 */
export const openInFileManager = (dir: string): boolean => {
  const platform = os.platform();
  const [ command, args ] = platform === 'win32'
    ? [ 'explorer.exe', [ dir ] ]
    : platform === 'darwin'
      ? [ 'open', [ dir ] ]
      : [ 'xdg-open', [ dir ] ];

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }
  catch {
    return false;
  }
};
