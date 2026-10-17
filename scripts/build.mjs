/**
 * 构建脚本：node scripts/build.mjs
 *
 * 1. esbuild 多入口打包（CJS / ESM 双格式），把 src 下所有模块内联进产物，
 *    产物零跨文件相对引用，从根本上避免 ESM 扩展名解析问题。
 * 2. tsc 生成类型声明（emitDeclarationOnly），避免手写 .d.ts 与实现脱节。
 *
 * 产物清单：
 *   dist/index.js            根入口 + CLI 目标（ESM）
 *   dist/vite.{mjs,cjs}      Vite 插件
 *   dist/webpack.{mjs,cjs}   Webpack 插件（vue.config.js 为 CJS，必须保留 cjs）
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * 被内联的 CJS 依赖（如 inquirer -> mute-stream）内部会调用 require()
 * 加载 Node 内置模块，ESM 下没有 require，需要注入 createRequire shim。
 * 导入名加前缀，避免与源码中同名导入（如 webpack.ts 的 createRequire）重复声明。
 */
const esmRequireBanner = {
  js: `import { createRequire as __harGenCreateRequire } from 'module';\nconst require = __harGenCreateRequire(import.meta.url);`,
};

const targets = [
  { entry: 'src/index.ts', out: 'dist/index.js', format: 'esm', banner: true },
  { entry: 'src/vite.ts', out: 'dist/vite.mjs', format: 'esm', banner: true },
  { entry: 'src/vite.ts', out: 'dist/vite.cjs', format: 'cjs' },
  { entry: 'src/webpack.ts', out: 'dist/webpack.mjs', format: 'esm', banner: true },
  { entry: 'src/webpack.ts', out: 'dist/webpack.cjs', format: 'cjs' },
];

/** 生成类型声明 */
const emitDeclarations = () => {
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

  if (!fs.existsSync(tsc)) {
    console.warn('  跳过 d.ts 生成：未安装 typescript');
    return;
  }

  execFileSync(process.execPath, [ tsc, '-p', path.join(root, 'tsconfig.build.json') ], {
    cwd: root,
    stdio: 'inherit',
  });
};

const run = async () => {
  fs.rmSync(distDir, { recursive: true, force: true });

  for (const target of targets) {
    await build({
      entryPoints: [ path.join(root, target.entry) ],
      outfile: path.join(root, target.out),
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: target.format,
      banner: target.banner ? esmRequireBanner : undefined,
      define: { __VERSION__: JSON.stringify(pkg.version) },
      logLevel: 'warning',
    });

    const size = fs.statSync(path.join(root, target.out)).size;
    console.log(`  ${target.out}  (${(size / 1024).toFixed(1)} KB)`);
  }

  emitDeclarations();

  // 校验：产物内不允许出现相对导入（ESM 下会因缺少扩展名而解析失败）
  const offenders = fs
    .readdirSync(distDir)
    .filter(file => /\.(js|mjs|cjs)$/.test(file))
    .filter((file) => {
      const content = fs.readFileSync(path.join(distDir, file), 'utf8');
      return /(?:from\s*|require\()\s*["']\.\//.test(content);
    });

  if (offenders.length > 0) {
    console.error(`FAIL: 产物中仍存在相对导入: ${offenders.join(', ')}`);
    process.exit(1);
  }

  console.log('build done');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
