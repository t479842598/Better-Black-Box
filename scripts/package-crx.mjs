// CRX3 打包脚本（Chrome 扩展 .crx，自签名）。
// 用法：node scripts/package-crx.mjs <zip路径> <输出crx路径> [--force-new-key]
// 私钥决定扩展 ID，请妥善备份。为避免 Chrome 在“加载已解压的扩展程序”时警告项目目录内含私钥文件，
// 私钥默认存放在项目外 ~/.better-xiaoheihe/key.pem，也可用环境变量 BETTER_XIAOHEIHE_KEY_PEM 指定路径；
// 仅在外部路径不存在时，才会回退到项目根 key.pem（旧版遗留，会自动迁移到外部路径）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const zipPath = path.resolve(process.argv[2] || '');
const crxPath = path.resolve(process.argv[3] || '');
const forceNewKey = process.argv.includes('--force-new-key');
if (!zipPath || !crxPath || !fs.existsSync(zipPath)) {
  console.error('用法：node scripts/package-crx.mjs <zip路径> <输出crx路径> [--force-new-key]');
  process.exit(1);
}

// ---- 1. 私钥 ----
// 查找顺序：环境变量指定 > ~/.better-xiaoheihe/key.pem > 项目根 key.pem（旧版遗留）
function resolveKeyPath() {
  const fromEnv = process.env.BETTER_XIAOHEIHE_KEY_PEM;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  const external = path.join(os.homedir(), '.better-xiaoheihe', 'key.pem');
  if (fs.existsSync(external)) {
    return external;
  }
  return path.join(root, 'key.pem');
}

let keyPath = resolveKeyPath();
const legacyKeyPath = path.join(root, 'key.pem');
if (keyPath !== legacyKeyPath && fs.existsSync(legacyKeyPath)) {
  // 旧版密钥在项目根：迁移到外部路径，避免 Chrome 解压加载警告
  fs.copyFileSync(legacyKeyPath, keyPath);
  fs.chmodSync(keyPath, 0o600);
  fs.rmSync(legacyKeyPath, { force: true });
  console.log(`已迁移项目根 key.pem 到 ${keyPath}（防止 Chrome 私钥文件警告）`);
}
let keyPem;
if (fs.existsSync(keyPath) && !forceNewKey) {
  keyPem = fs.readFileSync(keyPath, 'utf8');
  console.log(`复用私钥：${keyPath}`);
} else {
  const out = spawnSync('openssl', ['genrsa', '2048'], { encoding: 'utf8' });
  if (out.status !== 0) {
    console.error('生成 RSA 私钥失败（需要 openssl）：', out.stderr);
    process.exit(1);
  }
  keyPem = out.stdout;
  fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });
  console.log(`已生成新私钥：${keyPath}（请备份，私钥决定扩展 ID）`);
}
if (!keyPath) {
  // noop
}

// ---- 2. CRX3 打包 ----
const zip = fs.readFileSync(zipPath);
const publicKeyDer = crypto.createPublicKey(keyPem).export({ type: 'spki', format: 'der' });
const zipHash = crypto.createHash('sha256').update(zip).digest();

const u32le = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
const bytesField = (field, data) => {
  const tag = Buffer.from([(field << 3) | 2]);
  const len = [];
  let l = data.length;
  while (l > 0x7f) { len.push((l & 0x7f) | 0x80); l >>>= 7; }
  len.push(l);
  return Buffer.concat([tag, Buffer.from(len), data]);
};

// 签名数据：magic + pubkey 长度 + pubkey + sha256 长度 + zip 哈希
const signedData = Buffer.concat([
  Buffer.from('CRX3 SignedData\x00', 'latin1'),
  u32le(publicKeyDer.length),
  publicKeyDer,
  u32le(zipHash.length),
  zipHash
]);
const signature = crypto.sign('sha256', signedData, keyPem); // RSA PKCS1 v1.5

const proof = Buffer.concat([
  bytesField(1, publicKeyDer), // AsymmetricKeyProof.public_key
  bytesField(2, signature)     // AsymmetricKeyProof.signature
]);
const header = bytesField(2, proof); // CrxFileHeader.sha256_with_rsa (repeated)

const crx = Buffer.concat([
  Buffer.from('Cr24', 'latin1'),  // magic
  u32le(3),                       // CRX3 version
  u32le(header.length),           // header size
  header,
  zip
]);
fs.writeFileSync(crxPath, crx);

// 扩展 ID = 公钥 SHA256 前 16 字节的 base32（去掉 padding，小写），与 Chrome 计算一致
const idHash = crypto.createHash('sha256').update(publicKeyDer).digest('hex');
const idBytes = Buffer.from(idHash.slice(0, 32), 'hex');
const base32Chars = 'abcdefghijklmnopqrstuvwxyz234567';
let bits = 0, value = 0, id = '';
for (const byte of idBytes) {
  value = (value << 8) | byte;
  bits += 8;
  while (bits >= 5) {
    id += base32Chars[(value >>> (bits - 5)) & 31];
    bits -= 5;
  }
}
if (bits > 0) id += base32Chars[(value << (5 - bits)) & 31];

console.log(`CRX3 打包完成：${crxPath}（${(crx.length / 1024).toFixed(1)} KB）`);
console.log(`扩展 ID：${id}（自签名 CRX 仅本机/企业策略可安装，商店分发请用 zip）`);