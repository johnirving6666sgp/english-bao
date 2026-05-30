const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });

const hashText = async (text) => {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
};

const audioResponse = (buffer, cacheState) =>
  new Response(buffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Audio-Cache': cacheState
    }
  });

const getOrCreateAudio = async ({ env, text, audioKey, cacheKey, label }) => {
  let essayJson = null;
  if (env.WRITING_CACHE && cacheKey) {
    essayJson = await env.WRITING_CACHE.get(cacheKey, 'json');
  }

  const resolvedText = text || essayJson?.bandSevenVersion || '';
  const resolvedAudioKey = audioKey || essayJson?.audioKey || '';
  if (!resolvedText && !resolvedAudioKey) {
    return jsonResponse({ error: '没有可朗读的作文内容。' }, 400);
  }

  if (env.WRITING_CACHE && resolvedAudioKey) {
    const cached = await env.WRITING_CACHE.get(resolvedAudioKey, 'arrayBuffer');
    if (cached) return audioResponse(cached, 'HIT');
  }

  if (!resolvedText) {
    return jsonResponse({ error: '音频还没有生成，且找不到对应范文。' }, 404);
  }

  if (!env.OPENAI_API_KEY) {
    return jsonResponse({ error: '高品质朗读还没有配置 OPENAI_API_KEY。' }, 503);
  }

  const textHash = await hashText(resolvedText);
  const key = resolvedAudioKey || `writing:band7-audio:${textHash}`;
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: env.OPENAI_WRITING_TTS_VOICE || env.OPENAI_TTS_VOICE || 'coral',
      input: resolvedText,
      response_format: 'mp3',
      instructions:
        'Read this IELTS Band 7 sample essay in clear, natural English for an English learner. Use a warm teacher-like tone, steady pacing, crisp word endings, and short pauses between sentences. Do not sound robotic.'
    })
  });

  if (!response.ok) {
    const message = await response.text();
    return jsonResponse({ error: message || '高品质朗读生成失败。' }, 502);
  }

  const buffer = await response.arrayBuffer();
  if (env.WRITING_CACHE) {
    await env.WRITING_CACHE.put(key, buffer, {
      metadata: {
        type: 'writing-band-seven-audio',
        label: label || '7分示范版作文',
        textHash,
        createdAt: new Date().toISOString()
      }
    });

    if (cacheKey && essayJson) {
      await env.WRITING_CACHE.put(
        cacheKey,
        JSON.stringify({
          ...essayJson,
          audioKey: key,
          audioGeneratedAt: new Date().toISOString()
        }),
        {
          metadata: {
            type: 'writing-band-seven',
            topicId: essayJson.topic?.id || '',
            audioKey: key
          }
        }
      );
    }
  }

  return audioResponse(buffer, 'MISS');
};

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const cacheKey = url.searchParams.get('cacheKey') || '';
    const audioKey = url.searchParams.get('audioKey') || '';
    const label = url.searchParams.get('label') || '7分示范版作文';
    return await getOrCreateAudio({ env, text: '', audioKey, cacheKey, label });
  } catch (error) {
    return jsonResponse({ error: error.message || '高品质朗读暂时不可用。' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: '请求格式不正确。' }, 400);
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    return jsonResponse({ error: '没有可朗读的作文内容。' }, 400);
  }

  const textHash = await hashText(text);
  const audioKey =
    typeof payload.audioKey === 'string' && payload.audioKey.startsWith('writing:')
      ? payload.audioKey
      : `writing:band7-audio:${textHash}`;

  try {
    return await getOrCreateAudio({
      env,
      text,
      audioKey,
      cacheKey: payload.cacheKey,
      label: payload.label
    });
  } catch (error) {
    return jsonResponse({ error: error.message || '高品质朗读暂时不可用。' }, 500);
  }
}
