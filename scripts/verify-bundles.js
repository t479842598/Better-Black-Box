// 验证：按入口文件中的 // BEGIN 标记顺序，用模块源文件重建入口文件并对比
const fs = require('fs');
const path = require('path');

const root = process.cwd();

function getModuleOrder(entryPath) {
  const content = fs.readFileSync(entryPath, 'utf8');
  const order = [];
  const re = /\/\/ BEGIN (src[^\r\n]*)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    order.push(m[1].replace(/\\\\/g, '/'));
  }
  return order;
}

function rebuild(entryPath) {
  const order = getModuleOrder(entryPath);
  const lines = [];
  lines.push('(function () {');
  lines.push('  // Generated from module sources by scripts/build-source-bundles.ps1.');
  lines.push('  // Do not edit this generated entry file directly; changes will be overwritten.');
  lines.push('  // <EditHint>'); // 占位，对比时忽略
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

for (const entry of ['src/content.js', 'src/background.js', 'src/ai-bridge.js']) {
  const rebuilt = rebuild(entry);
  const original = fs.readFileSync(entry, 'utf8');
  // 忽略第 4 行 EditHint 注释差异（按输出文件不同而不同）
  const normalize = (s) => s.split('\n').map((l, i) => (i === 3 ? '  // <EditHint>' : l)).join('\n');
  if (normalize(rebuilt) === normalize(original)) {
    console.log('MATCH: ' + entry);
  } else {
    console.log('DIFF: ' + entry);
    const a = rebuilt.split('\n');
    const b = original.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i === 3) continue; // 忽略 EditHint 行
      if (a[i] !== b[i]) {
        console.log('  first diff at line ' + (i + 1));
        console.log('  rebuilt  : ' + JSON.stringify(a[i]?.slice(0, 120)));
        console.log('  original : ' + JSON.stringify(b[i]?.slice(0, 120)));
        break;
      }
    }
  }
}
