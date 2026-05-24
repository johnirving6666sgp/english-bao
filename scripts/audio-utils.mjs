import { rm, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const normalizeAudioFile = async (filePath, options = {}) => {
  const targetI = options.targetI ?? process.env.AUDIO_LOUDNESS_I ?? '-18';
  const targetTP = options.targetTP ?? process.env.AUDIO_LOUDNESS_TP ?? '-1.5';
  const targetLRA = options.targetLRA ?? process.env.AUDIO_LOUDNESS_LRA ?? '11';
  const tmpPath = `${filePath}.normalizing.mp3`;

  await rm(tmpPath, { force: true });
  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    filePath,
    '-af',
    `loudnorm=I=${targetI}:TP=${targetTP}:LRA=${targetLRA}`,
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '128k',
    tmpPath
  ]);
  await rename(tmpPath, filePath);
};
