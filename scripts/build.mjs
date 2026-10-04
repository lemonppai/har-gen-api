/**
 * 构建脚本：node scripts/build.mjs
 *
 * 所有入口均开启 bundle，将 mockCore 内联进各产物，
 * 产物之间零跨文件引用，从根本上避免 ESM/CJS 扩展名解析问题
 * （ESM 要求相对导入必须带显式扩展名）。
 */
import { build } from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ESM 产物中，被内联的 CJS 依赖（如 inquirer -> mute-stream -> stream）
 * 会调用 require() 加载 Node 内置模块，ESM 下没有 require 可用。
 * 注入 createRequire shim 让动态 require 落回真实 CommonJS 机制。
 */
const esmRequireBanner = {
  js: `import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);`,
};

const targets = [
  { entry: 'index.ts', out: 'dist/index.js', format: 'esm', banner: true },
  { entry: 'mockServer.ts', out: 'dist/mockServer.cjs', format: 'cjs' },
  { entry: 'mockServer.ts', out: 'dist/mockServer.mjs', format: 'esm', banner: true },
  { entry: 'mockServer.webpack.ts', out: 'dist/mockServer.webpack.cjs', format: 'cjs' },
  { entry: 'mockServer.webpack.ts', out: 'dist/mockServer.webpack.mjs', format: 'esm', banner: true },
];

const run = async () => {
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });

  for (const target of targets) {
    await build({
      entryPoints: [path.join(root, target.entry)],
      outfile: path.join(root, target.out),
      bundle: true,
      platform: 'node',
      target: 'node16',
      format: target.format,
      banner: target.banner ? esmRequireBanner : undefined,
      logLevel: 'warning',
    });
    console.log(`  ${target.out}`);
  }

  // 校验：产物内不允许存在相对导入
  const distDir = path.join(root, 'dist');
  const offenders = fs.readdirSync(distDir)
    .filter((f) => /\.(cjs|mjs|js)$/.test(f))
    .filter((f) => {
      const content = fs.readFileSync(path.join(distDir, f), 'utf8');
      return /(?:from\s*|require\()\s*["']\.\//.test(content);
    });

  if (offenders.length) {
    console.error(`FAIL: 产物中仍存在相对导入: ${offenders.join(', ')}`);
    process.exit(1);
  }

  console.log('build done (no relative imports)');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
