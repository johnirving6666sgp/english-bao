import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAudioFile } from './audio-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioDir = path.join(root, 'public', 'audio', 'examples');

const getArg = (name, fallback = '') => {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const limit = Number(getArg('--limit', '0'));
const dryRun = process.argv.includes('--dry-run');

const fileExists = async (filePath) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const main = async () => {
  if (!(await fileExists(audioDir))) {
    throw new Error(`Audio directory not found: ${audioDir}`);
  }

  const files = (await readdir(audioDir))
    .filter((fileName) => fileName.endsWith('.mp3') && !fileName.includes('.normalizing.'))
    .sort();
  const targets = limit > 0 ? files.slice(0, limit) : files;

  for (const [index, fileName] of targets.entries()) {
    const filePath = path.join(audioDir, fileName);
    console.log(`[normalize] ${index + 1}/${targets.length} ${fileName}`);
    if (!dryRun) await normalizeAudioFile(filePath);
  }

  console.log(`Done. normalized=${dryRun ? 0 : targets.length}, total=${files.length}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
