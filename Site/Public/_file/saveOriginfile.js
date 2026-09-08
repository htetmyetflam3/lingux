import fs from 'fs-extra';
import path from 'path';
import { QUARANTINE_DIR } from './paths.js';
export function createSaveOriginal({ quarantineDir } = {}) {
  // Quarantine copies live inside the PRASER python project by default
  // (.../PRASER/Python/upload/quarantine).
  const dir = quarantineDir || QUARANTINE_DIR;
  return async function saveOriginal(file) {
    await fs.ensureDir(dir);
    const dest = path.join(dir, `${Date.now()}_${file.originalname}`);
    await fs.copy(file.path, dest);
    return dest;
  };
}
