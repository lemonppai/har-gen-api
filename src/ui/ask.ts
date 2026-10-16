import inquirer from 'inquirer';

/** 输出目录：不允许以 `/` 开头（避免写出到系统根路径） */
export const validateOutput = (value: string): true | string =>
  /^(?!\/)[^\0]+$/.test(value.trim()) ? true : '格式不正确，不能以 / 开头';

/** baseURL：必须以 `/` 开头 */
export const validateBaseURL = (value: string): true | string =>
  /^\/[^\0]+$/.test(value.trim()) ? true : '格式不正确，需以 / 开头';

/** 文本输入，返回去除首尾空格后的值 */
export const askInput = async (
  message: string,
  defaultValue: string,
  validate: (value: string) => true | string
): Promise<string> => {
  const answers = await inquirer.prompt<{ value: string }>([
    { type: 'input', name: 'value', message, default: defaultValue, validate },
  ]);

  return answers.value.trim();
};

/** 确认输入 */
export const askConfirm = async (message: string, defaultValue: boolean): Promise<boolean> => {
  const answers = await inquirer.prompt<{ value: boolean }>([
    { type: 'confirm', name: 'value', message, default: defaultValue },
  ]);

  return answers.value;
};
