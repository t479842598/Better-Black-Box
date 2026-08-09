// 按 scripts/build-source-bundles.ps1 中的模块列表生成入口文件（与 PowerShell 版等价）。
// 用法：node scripts/rebuild-bundles.js [--check]
//  --check  只对比不写入（MATCH/DIFF 判定）
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const checkOnly = process.argv.includes('--check');

// 解析 ps1 中的 Join-SourceBundle 调用，提取 OutputPath 与 Files 列表
function parsePs1Bundles(ps1Path) {
  const text = fs.readFileSync(ps1Path, 'utf8').replace(/\r\n/g, '\n');
  const bundles = [];
  // 每个 Join-SourceBundle 块：-OutputPath "..." ... -Files @( "a", "b" )
  const re = /Join-SourceBundle\s*`?\s*-OutputPath\s*\(?\s*Join-Path\s+\$root\s+"([^"]+)"[\s\S]*?-Files\s*@\(\s*([\s\S]*?)\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const output = m[1];
    const files = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    bundles.push({ output, files });
  }
  if (!bundles.length) {
    throw new Error('未能从 build-source-bundles.ps1 解析出模块列表');
  }
  return bundles;
}

function buildEntry(bundle) {
  const lines = [];
  lines.push('(function () {');
  lines.push('  // Generated from module sources by scripts/build-source-bundles.ps1.');
  lines.push('  // Do not edit this generated entry file directly; changes will be overwritten.');
  lines.push('  // <EditHint>');
  for (const file of bundle.files) {
    const p = path.join(root, file.replace(/\\/g, '/'));
    if (!fs.existsSync(p)) {
      throw new Error('Missing source chunk: ' + p);
    }
    lines.push('  // BEGIN ' + file);
    const src = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const fileLines = src.split('\n');
    if (fileLines[fileLines.length - 1] === '') fileLines.pop();
    for (const line of fileLines) {
      lines.push(line);
    }
    lines.push('  // END ' + file);
  }
  lines.push('})();');
  return lines.join('\r\n') + '\r\n';
}

const normalize = (s) => s.split('\n').map((l, i) => (i === 3 ? '  // <EditHint>' : l)).join('\n');

const bundles = parsePs1Bundles(path.join(root, 'scripts/build-source-bundles.ps1'));
for (const bundle of bundles) {
  const entryPath = path.join(root, bundle.output.replace(/\\/g, '/'));
  const rebuilt = buildEntry(bundle);
  const original = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf8') : null;
  if (original !== null && normalize(rebuilt) === normalize(original)) {
    console.log('MATCH: ' + bundle.output);
  } else {
    if (checkOnly) {
      console.log('DIFF: ' + bundle.output + '（请先运行不带 --check 的 rebuild）');
      process.exitCode = 1;
    } else {
      fs.writeFileSync(entryPath, rebuilt, 'utf8');
      console.log('REBUILT: ' + bundle.output);
    }
  }
}
