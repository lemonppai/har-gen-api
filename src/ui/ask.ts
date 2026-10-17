import inquirer from 'inquirer';

/** 输出目录：不允许以 `/` 开头（避免写出到系统根路径） */
export const validateOutput = (value: string): true | string =>
  /^(?!\/)[^\0]+$/.test(value.trim()) ? true : '格式不正确，不能以 / 开头';

/** baseURL：必须以 `/` 开头 */
export const validateBaseURL = (value: string): true | string =>
  /^\/[^\0]+$/.test(value.trim()) ? true : '格式不正确，需以 / 开头';

/** 单选项 */
export interface Choice<T> {
  name: string;
  value: T;
}

export type ChoiceOrSeparator<T> = Choice<T> | InstanceType<typeof inquirer.Separator>;

/** 菜单分隔线 */
export const separator = (): InstanceType<typeof inquirer.Separator> => new inquirer.Separator();

/** 单选菜单 */
export const askSelect = async <T>(options: {
  message: string;
  choices: ChoiceOrSeparator<T>[];
  pageSize?: number;
}): Promise<T> => {
  const answers = await inquirer.prompt<{ value: T }>([
    {
      type: 'select',
      name: 'value',
      message: options.message,
      choices: options.choices,
      pageSize: options.pageSize ?? 15,
      loop: false,
    },
  ]);

  return answers.value;
};

/** 文本输入，返回去除首尾空格后的值 */
export const askInput = async (
  message: string,
  defaultValue = '',
  validate?: (value: string) => true | string
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
