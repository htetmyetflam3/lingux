import crypto from 'crypto';
const SECRET = process.env.COOKIE_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error('COOKIE_SECRET must be at least 32 characters');
}
const KEY = Buffer.from(SECRET.slice(0, 32));
export function encodeCookie(data) {
  const json = JSON.stringify(data);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv);
  let encrypted = cipher.update(json, 'utf8', 'base64url');
  encrypted += cipher.final('base64url');
  return iv.toString('base64url') + '.' + encrypted;
}
export function decodeCookie(value) {
  try {
    const [ivStr, encrypted] = value.split('.');
    if (!ivStr || !encrypted) return null;
    const iv = Buffer.from(ivStr, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv);
    let decrypted = decipher.update(encrypted, 'base64url', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}
