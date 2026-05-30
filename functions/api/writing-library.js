const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });

const toDateKey = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const readLibraryItem = async (env, key) => {
  const item = await env.WRITING_CACHE.get(key, 'json');
  if (!item?.bandSevenVersion) return null;

  return {
    key,
    createdAt: item.createdAt || '',
    date: toDateKey(item.createdAt),
    topic: item.topic || null,
    sourceWordCount: item.sourceWordCount || 0,
    bandSevenVersion: item.bandSevenVersion,
    conservativeRewrite: item.conservativeRewrite || '',
    audioKey: item.audioKey || '',
    audioGeneratedAt: item.audioGeneratedAt || ''
  };
};

export async function onRequestGet({ request, env }) {
  if (!env.WRITING_CACHE) {
    return jsonResponse({ error: '写作范文库还没有配置 WRITING_CACHE。', items: [] }, 503);
  }

  try {
    const url = new URL(request.url);
    const category = url.searchParams.get('category') || 'all';
    const date = url.searchParams.get('date') || 'all';
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 80, 1), 100);

    const listed = await env.WRITING_CACHE.list({
      prefix: 'writing:band7:',
      limit
    });

    const items = (
      await Promise.all(listed.keys.map((entry) => readLibraryItem(env, entry.name)))
    )
      .filter(Boolean)
      .filter((item) => category === 'all' || item.topic?.category === category)
      .filter((item) => date === 'all' || item.date === date)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return jsonResponse({
      items,
      cursor: listed.cursor || '',
      hasMore: Boolean(listed.list_complete === false)
    });
  } catch (error) {
    return jsonResponse({ error: error.message || '写作范文库暂时不可用。', items: [] }, 500);
  }
}
