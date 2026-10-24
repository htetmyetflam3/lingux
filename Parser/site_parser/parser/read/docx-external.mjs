import mammoth from "mammoth";


export async function extractDocxParagraphsExternal(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const { value } = await mammoth.extractRawText({ buffer });
  return value
    .split("\n")
    .filter((line) => line.trim().length > 0);
}
