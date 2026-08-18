// API Key 落盘加密：设置 VAULT_ENC_KEY 后，config.json 里的 ai.apiKey 以
// AES-256-GCM 密文保存（enc:v1: 前缀）；未设置时保持明文，兼容既有数据。
const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function key() {
  return crypto.createHash('sha256').update(String(process.env.VAULT_ENC_KEY || '')).digest();
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

module.exports = { encryptApiKey, decryptApiKey };
