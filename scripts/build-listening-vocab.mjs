import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/build-listening-vocab.mjs <ocr-json> <output-js>');
  process.exit(2);
}

const pages = JSON.parse(await readFile(inputPath, 'utf8'));

const sceneNames = [
  '住宿租房',
  '住宿租房',
  '房屋设施',
  '房屋设施',
  '家具用品',
  '校园生活',
  '课程学习',
  '课程学习',
  '自然地理',
  '自然地理',
  '旅游交通',
  '旅游交通',
  '城市地点',
  '城市地点',
  '图书馆',
  '图书馆',
  '银行消费',
  '银行消费',
  '银行消费',
  '银行消费',
  '工作职业',
  '工作职业',
  '医疗健康',
  '医疗健康',
  '动植物',
  '动植物',
  '科技媒体',
  '科技媒体',
  '环境能源',
  '环境能源',
  '社会文化',
  '社会文化',
  '时间日期',
  '时间日期',
  '数字计量',
  '数字计量',
  '研究调查',
  '研究调查',
  '艺术活动',
  '艺术活动',
  '饮食营养',
  '饮食营养',
  '生物科学',
  '生物科学',
  '科学术语',
  '科学术语',
  '健康科学'
];

const badText = /^(aiC|\*X#X|#|第|雅思|编号|词汇|词性|中文|英文|例句|\$?\d+\s*[hM]\.?|[•·]+)$/i;
const posWords = new Set(['noun', 'verb', 'adj.', 'adv.', 'adjective', 'adverb', 'num.', 'prep.']);

const normalizeText = (value) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/\bownsa\b/g, 'owns a')
    .replace(/\bpaidby\b/g, 'paid by')
    .replace(/\bpeoplefor\b/g, 'people for')
    .replace(/\bpieceof\b/g, 'piece of')
    .replace(/\broomwith\b/g, 'room with')
    .replace(/\borganizedway\b/g, 'organized way')
    .replace(/\bprevioussuccessful\b/g, 'previous successful')
    .replace(/\bincludingtuition\b/g, 'including tuition')
    .replace(/\bCrossStreet\b/g, 'Cross Street')
    .trim();

const cleanTerm = (value) =>
  normalizeText(value)
    .replace(/^[^\w(]+/, '')
    .replace(/^\d+\s*/, '')
    .replace(/^T(?=off-campus)/, '')
    .replace(/^\|+/, '')
    .replace(/\s+/g, ' ')
    .trim();

const looksLikeTerm = (term) =>
  /^[A-Za-z][A-Za-z0-9 /().,&€$'-]{1,44}$/.test(term) &&
  !posWords.has(term.toLowerCase()) &&
  !badText.test(term);

const parseRowAnchor = (line) => {
  if (line.x > 0.18) return null;
  const text = normalizeText(line.text);
  if (badText.test(text)) return null;
  const leading = text.match(/^(\d{1,3})\s*(.*)$/);
  if (leading) {
    return { number: Number(leading[1]), termPart: cleanTerm(leading[2]), y: line.y };
  }
  const compact = text.match(/^([IlT])(?=off-campus)/);
  if (compact) return null;
  if (/^\d{1,3}$/.test(text)) {
    return { number: Number(text), termPart: '', y: line.y };
  }
  const term = cleanTerm(text);
  if (looksLikeTerm(term)) {
    return { number: null, termPart: term, y: line.y };
  }
  return null;
};

const entries = [];

for (const page of pages) {
  const lines = page.lines
    .map((line) => ({ ...line, text: normalizeText(line.text) }))
    .filter((line) => line.text && !badText.test(line.text));

  const rawAnchors = [];
  for (const line of lines) {
    const anchor = parseRowAnchor(line);
    if (!anchor) continue;
    const last = rawAnchors[rawAnchors.length - 1];
    if (last && Math.abs(last.y - anchor.y) < 0.012) {
      if (!last.termPart && anchor.termPart) last.termPart = anchor.termPart;
      if (!last.number && anchor.number) last.number = anchor.number;
      continue;
    }
    rawAnchors.push(anchor);
  }

  rawAnchors.sort((a, b) => b.y - a.y);

  const anchors = [];
  for (const anchor of rawAnchors) {
    const last = anchors[anchors.length - 1];
    if (last && !anchor.number && Math.abs(last.y - anchor.y) < 0.022) {
      if (anchor.termPart && !last.termPart.includes(anchor.termPart)) {
        last.termPart = `${last.termPart} ${anchor.termPart}`.trim();
      }
      continue;
    }
    anchors.push({ ...anchor });
  }

  let inferredNumber = anchors.find((anchor) => Number.isFinite(anchor.number))?.number ?? 1;

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (!Number.isFinite(anchor.number)) {
      anchor.number = inferredNumber;
    }
    inferredNumber = anchor.number + 1;
    const previousY = index === 0 ? 1 : anchors[index - 1].y;
    const nextY = index === anchors.length - 1 ? 0 : anchors[index + 1].y;
    const top = (previousY + anchor.y) / 2;
    const bottom = (anchor.y + nextY) / 2;
    const group = lines.filter((line) => line.y <= top && line.y > bottom);

    const termParts = [];
    if (anchor.termPart) termParts.push(anchor.termPart);
    for (const line of group) {
      if (line.x >= 0.055 && line.x < 0.19) {
        const term = cleanTerm(line.text);
        if (looksLikeTerm(term) && !termParts.includes(term)) termParts.push(term);
      }
    }

    let term = termParts.join(' ').trim();
    term = term.replace(/\s+\(/g, '(').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
    if (!looksLikeTerm(term)) continue;

    const partOfSpeech = group
      .map((line) => (line.x >= 0.18 && line.x < 0.28 ? line.text.toLowerCase() : ''))
      .find((text) => posWords.has(text));

    const englishDefinition = group
      .filter((line) => line.x >= 0.32 && line.x < 0.66)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((line) => line.text)
      .join(' ');

    const example = group
      .filter((line) => line.x >= 0.62)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((line) => line.text)
      .join(' ');

    if (!englishDefinition && !example && term.split(' ').length > 4) continue;

    entries.push({
      id: `listen-p${page.page}-${index + 1}`,
      number: anchor.number,
      order: entries.length + 1,
      page: page.page,
      scene: sceneNames[page.page - 1] ?? `PDF 第 ${page.page} 页`,
      term,
      partOfSpeech: partOfSpeech || '',
      meaning: '',
      englishDefinition: normalizeText(englishDefinition),
      example: normalizeText(example)
    });
  }
}

const unique = entries.sort((a, b) => a.order - b.order);

const source = `// Generated from 雅思听力场景词汇.pdf via OCR.\n// Chinese meanings are intentionally left blank when OCR confidence is poor.\nexport const listeningVocabEntries = ${JSON.stringify(unique, null, 2)};\n`;

await writeFile(outputPath, source);
console.log(`Wrote ${unique.length} listening vocabulary entries to ${outputPath}`);
