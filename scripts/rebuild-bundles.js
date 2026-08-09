// 按入口文件中的 // BEGIN 标记顺序，用模块源文件重新生成入口文件。
// 用法：node scripts/rebuild-bundles.js [--check]
//  --check  只对比不写入（等价 verify-bundles.js 的 MATCH 判定）
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const checkOnly = process.argv.includes('--check');

function getModuleOrder(entryPath) {
  const content = fs.readFileSync(entryPath, 'utf8');
  const order = [];
  const re = /\/\/ BEGIN (src[^\r\n]*)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    order.push(m[1]);
  }
  return order;
}

function rebuild(entryPath) {
  const order = getModuleOrder(entryPath);
  const lines = [];
  lines.push('(function () {');
  lines.push('  // Generated from module sources by scripts/build-source-bundles.ps1.');
  lines.push('  // Do not edit this generated entry file directly; changes will be overwritten.');
  lines.push('  // <EditHint>');
  for (const file of order) {
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

for (const entry of ['src/content.js', 'src/background.js', 'src/ai-bridge.js']) {
  const rebuilt = rebuild(entry);
  const original = fs.readFileSync(entry, 'utf8');
  if (normalize(rebuilt) === normalize(original)) {
    console.log('MATCH: ' + entry);
  } else {
    if (checkOnly) {
      console.log('DIFF: ' + entry + '（请检查模块源是否被修改）');
      process.exitCode = 1;
    } else {
      fs.writeFileSync(entry, rebuilt, 'utf8');
      console.log('REBUILT: ' + entry);
    }
  }
}
