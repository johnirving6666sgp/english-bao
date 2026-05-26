import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [numbersPath, outputPath] = process.argv.slice(2);

if (!numbersPath || !outputPath) {
  console.error('Usage: node scripts/build-listening-vocab-from-xlsx.mjs <numbers-file> <output-js>');
  process.exit(2);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workbookPath = '/tmp/english-bao-listening.xlsx';
const extractDir = '/tmp/english-bao-listening-xlsx';

const decodeXml = (value = '') =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const normalize = (value = '') => value.replace(/\s+/g, ' ').trim();

const columnIndex = (cellRef) => {
  const letters = cellRef.match(/[A-Z]+/)?.[0] ?? 'A';
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const parseSharedStrings = (xml) =>
  [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((textMatch) => decodeXml(textMatch[1])).join('')
  );

const parseSheet = (xml, sharedStrings) =>
  [...xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1];
      if (!ref) continue;
      const value = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
      const isShared = /\bt="s"/.test(attrs);
      row[columnIndex(ref)] = normalize(isShared ? sharedStrings[Number(value)] ?? '' : decodeXml(value));
    }
    return row;
  });

const exportNumbers = () => {
  const script = `
tell application "Numbers"
  set theDoc to open POSIX file "${numbersPath.replaceAll('"', '\\"')}"
  delay 1
  export theDoc to POSIX file "${workbookPath}" as Microsoft Excel
  close theDoc saving no
end tell
`;
  execFileSync('osascript', ['-e', script], { stdio: 'inherit' });
};

const oldModulePath = path.join(__dirname, '..', 'src', 'listeningVocabData.js');
const previousEntries = await import(pathToFileURL(oldModulePath).href)
  .then((module) => module.listeningVocabEntries ?? [])
  .catch(() => []);

await rm(workbookPath, { force: true });
await rm(extractDir, { recursive: true, force: true });
await mkdir(extractDir, { recursive: true });

exportNumbers();
execFileSync('unzip', ['-q', workbookPath, '-d', extractDir], { stdio: 'inherit' });

const sharedStrings = parseSharedStrings(await readFile(path.join(extractDir, 'xl/sharedStrings.xml'), 'utf8'));
const rows = parseSheet(await readFile(path.join(extractDir, 'xl/worksheets/sheet2.xml'), 'utf8'), sharedStrings);
const entries = rows
  .slice(1)
  .map((row, index) => {
    const number = Number(row[0]);
    const term = normalize(row[1]);
    const confusingTerm = normalize(row[2]);
    const example = normalize(row[3]);
    if (!number || !term || !confusingTerm) return null;
    const previous = previousEntries[index] ?? {};
    return {
      id: `listen-${number}`,
      number,
      order: index + 1,
      page: Math.floor(index / 33) + 1,
      scene: '听力场景词汇',
      term,
      confusingTerm,
      partOfSpeech: previous.partOfSpeech ?? '',
      meaning: previous.meaning ?? '',
      example
    };
  })
  .filter(Boolean);

const source = `// Generated from 雅思听力场景词汇_新增易听混淆词.numbers.\n// Columns: 词汇 / 易听混淆词 / 升级版地道例句.\nexport const listeningVocabEntries = ${JSON.stringify(entries, null, 2)};\n`;

await writeFile(outputPath, source);
console.log(`Wrote ${entries.length} listening vocabulary entries to ${outputPath}`);
