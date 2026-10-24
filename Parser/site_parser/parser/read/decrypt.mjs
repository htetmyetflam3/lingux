import { runQpdf } from "../core/qpdf.mjs";

const ENCRYPT_MARK = Buffer.from("/Encrypt");

export function isEncryptedPdf(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.includes(ENCRYPT_MARK);
}

export async function decryptPdf(bytes, log = () => {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!isEncryptedPdf(buf)) return buf;
  try {
    const { data: out, warnings } = await runQpdf(buf, ["--password=", "--decrypt"]);
    if (warnings) log(`[i] qpdf decrypt warning: ${warnings}`);
    log(
      `[+] PDF was encrypted; decrypted with qpdf `
        + `(${buf.length.toLocaleString("en-US")} -> ${out.length.toLocaleString("en-US")} bytes)`,
    );
    return out;
  } catch (cause) {
    if (/invalid password|password.*incorrect|requires a password/iu.test(String(cause?.message))) {
      throw new Error("This PDF needs a password to open; supply an unprotected copy.", { cause });
    }
    throw cause;
  }
}
