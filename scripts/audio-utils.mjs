import { rm, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const loudnormFilter = ({ targetI, targetTP, targetLRA, measured }) => {
  const base = `loudnorm=I=${targetI}:TP=${targetTP}:LRA=${targetLRA}`;
  if (!measured) return `${base}:print_format=json`;

  return [
    base,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
    'print_format=summary'
  ].join(':');
};

const measureLoudness = async (filePath, options) => {
  const { stderr } = await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    filePath,
    '-af',
    loudnormFilter(options),
    '-f',
    'null',
    '-'
  ]);
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error(`Could not read loudness data for ${filePath}`);
  }
  return JSON.parse(stderr.slice(start, end + 1));
};

export const normalizeAudioFile = async (filePath, options = {}) => {
  const targetI = options.targetI ?? process.env.AUDIO_LOUDNESS_I ?? '-18';
  const targetTP = options.targetTP ?? process.env.AUDIO_LOUDNESS_TP ?? '-1.5';
  const targetLRA = options.targetLRA ?? process.env.AUDIO_LOUDNESS_LRA ?? '11';
  const tmpPath = `${filePath}.normalizing.mp3`;
  const normalizedOptions = { targetI, targetTP, targetLRA };
  const measured = await measureLoudness(filePath, normalizedOptions);

  await rm(tmpPath, { force: true });
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    filePath,
    '-af',
    loudnormFilter({ ...normalizedOptions, measured }),
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '128k',
    tmpPath
  ]);
  await rename(tmpPath, filePath);
};
