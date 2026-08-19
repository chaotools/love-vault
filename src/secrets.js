// API Key 落盘加密：设置 VAULT_ENC_KEY 后，config.json 里的 ai.apiKey 以
// AES-256-GCM 密文保存（enc:v1: 前缀）；未设置时保持明文，兼容既有数据。
const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');

const PREFIX = 'enc:v1:';

function key() {
  return crypto.createHash('sha256').update(String(process.env.VAULT_ENC_KEY || '')).digest();
}

function encryptionEnabled() {
  return Boolean(process.env.VAULT_ENC_KEY);
}

function encryptApiKey(plain) {
  if (!plain || !process.env.VAULT_ENC_KEY) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function decryptApiKey(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value || '';
  if (!process.env.VAULT_ENC_KEY) return '';
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('API Key 解密失败（VAULT_ENC_KEY 是否变更？）:', e.message);
    return '';
  }
}

function isEncryptedApiKey(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

async function writeJsonAtomically(file, data) {
  const tmp = `${file}.encrypt-${process.pid}-${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

// 扫描主库及每个用户库的配置和其写时备份。迁移只会在配置了 VAULT_ENC_KEY
// 时执行；任何加密记录无法解密都让启动失败，避免服务静默降级到不可用状态。
async function migrateStoredApiKeys(dataDir) {
  if (!process.env.VAULT_ENC_KEY) return { migrated: 0, scanned: 0 };
  const roots = [dataDir];
  const usersDir = path.join(dataDir, 'users');
  const users = await fsp.readdir(usersDir, { withFileTypes: true }).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  for (const user of users) if (user.isDirectory()) roots.push(path.join(usersDir, user.name));

  let migrated = 0;
  let scanned = 0;
  for (const root of roots) {
    for (const suffix of ['', '.bak', '.tmp']) {
      const file = path.join(root, `config.json${suffix}`);
      let config;
      try {
        config = JSON.parse(await fsp.readFile(file, 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') continue;
        throw new Error(`无法读取 API Key 配置 ${file}: ${e.message}`);
      }
      scanned++;
      const apiKey = config && config.ai && config.ai.apiKey;
      if (!apiKey) continue;
      if (isEncryptedApiKey(apiKey)) {
        if (!decryptApiKey(apiKey)) throw new Error(`VAULT_ENC_KEY 无法解密 ${file}`);
        continue;
      }
      config.ai.apiKey = encryptApiKey(apiKey);
      await writeJsonAtomically(file, config);
      migrated++;
    }
  }
  return { migrated, scanned };
}

module.exports = { encryptApiKey, decryptApiKey, encryptionEnabled, isEncryptedApiKey, migrateStoredApiKeys };
