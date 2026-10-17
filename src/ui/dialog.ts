import os from 'node:os';
import { execFileSync } from 'node:child_process';

/** 单个平台的对话框执行器，返回选中的路径；取消时返回 `null` */
type DialogRunner = (title: string) => string | null;

const FILTER_LABEL = 'HAR 文件 (*.har)|*.har|所有文件 (*.*)|*.*';

/**
 * 各平台的文件选择实现。
 *
 * - Windows：PowerShell + System.Windows.Forms.OpenFileDialog
 *   用 `-EncodedCommand`（UTF-16LE Base64）传脚本，规避命令行代码页对中文参数的破坏；
 *   脚本内强制 `[Console]::OutputEncoding = UTF8`，保证中文文件名按 UTF-8 返回。
 * - macOS：osascript choose file
 * - Linux：优先 zenity，缺失时降级 kdialog
 */
const RUNNERS: Record<string, DialogRunner> = {
  win32: (title) => {
    const script = [
      '$ErrorActionPreference = "Stop";',
      'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {};',
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$FileDialog = New-Object System.Windows.Forms.OpenFileDialog;',
      `$FileDialog.Filter = '${FILTER_LABEL}';`,
      `$FileDialog.Title = '${title.replace(/'/g, "''")}';`,
      '$result = $FileDialog.ShowDialog();',
      'if ($result -eq "OK") { [Console]::Out.Write($FileDialog.FileName) }',
    ].join(' ');

    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    return execFileSync(
      'powershell.exe',
      [ '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded ],
      { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] },
    ).trim() || null;
  },

  darwin: (title) => {
    const escaped = title.replace(/"/g, '\\"');
    const script =
      `tell application "System Events" to set harFile to choose file with prompt "${escaped}" `
      + `of type {"har", "public.data"} as alias`;
    const output = execFileSync(
      'osascript',
      [ '-e', script, '-e', 'return POSIX path of harFile' ],
      { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] },
    ).trim();
    return output || null;
  },

  linux: (title) => {
    for (const command of [
      [ 'zenity', '--file-selection', `--title=${title}`, '--file-filter=HAR 文件 *.har' ],
      [ 'kdialog', '--getopenfilename', '.', '*.har', `--title`, title ],
    ]) {
      try {
        return execFileSync(command[ 0 ], command.slice(1), {
          encoding: 'utf8',
          stdio: [ 'ignore', 'pipe', 'ignore' ],
        }).trim() || null;
      }
      catch {
        // 尝试下一个候选
      }
    }
    return null;
  },
};

/**
 * 当前平台是否支持弹出文件选择对话框。
 *
 * Linux 桌面环境不一定安装 zenity / kdialog，缺失时命令会失败，
 * 由调用方按「用户取消」处理并给出降级提示。
 */
export const isDialogSupported = (): boolean => os.platform() in RUNNERS;

/**
 * 弹出系统文件选择对话框，返回选中的绝对路径。
 *
 * @returns 用户选中的路径；取消或当前平台不支持时返回 `null`
 */
export const selectHarFile = (title = '请选择 HAR 文件'): string | null => {
  const runner = RUNNERS[ os.platform() ];

  if (!runner) {
    return null;
  }

  try {
    return runner(title);
  }
  catch {
    // 用户取消 / 命令不可用，统一按未选择处理
    return null;
  }
};
