// 腾讯位置服务：服务端地点输入提示与逆地址解析，不向浏览器暴露 WebService Key。
const SUGGESTION_URL = 'https://apis.map.qq.com/ws/place/v1/suggestion';
const GEOCODER_URL = 'https://apis.map.qq.com/ws/geocoder/v1/';
const DEFAULT_CACHE_TTL = 5 * 60_000;
const MAX_CACHE_ENTRIES = 500;

function tencentError(body, fallback = '腾讯位置服务请求失败') {
  const status = Number(body && body.status);
  const error = new Error((body && body.message) || fallback);
  error.tencentStatus = Number.isFinite(status) ? status : null;
  error.requestId = body && body.request_id;
  if (status === 121) error.status = 429;
  else if (status === 110 || status === 111 || status === 112) error.status = 502;
  else error.status = 502;
  return error;
}

function normalizePlace(place) {
  const lat = Number(place && place.location && place.location.lat);
  const lng = Number(place && place.location && place.location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: String(place.id || ''),
    name: String(place.title || ''),
    address: String(place.address || ''),
    category: String(place.category || ''),
    lat,
    lng,
    coordSystem: 'gcj02',
    provider: 'tencent'
  };
}

function createTencentMapClient({ key, referer = '', fetchImpl = globalThis.fetch, cacheTtlMs = DEFAULT_CACHE_TTL, now = Date.now } = {}) {
  const cache = new Map();

  const request = async (endpoint, params) => {
    if (!key) {
      const error = new Error('腾讯位置服务未配置：请设置 TENCENT_MAP_WEBSERVICE_KEY');
      error.status = 503;
      throw error;
    }
    const url = new URL(endpoint);
    for (const [name, value] of Object.entries({ ...params, key })) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }
    const headers = { Accept: 'application/json' };
    if (referer) {
      headers.Referer = referer;
      try { headers.Origin = new URL(referer).origin; } catch { /* ignore invalid referer */ }
    }
    let response;
    try {
      response = await fetchImpl(url, { headers, signal: AbortSignal.timeout ? AbortSignal.timeout(10_000) : undefined });
    } catch (error) {
      const wrapped = new Error('无法连接腾讯位置服务：' + error.message);
      wrapped.status = 502;
      throw wrapped;
    }
    if (!response.ok) {
      const wrapped = new Error('腾讯位置服务 HTTP ' + response.status);
      wrapped.status = response.status === 429 ? 429 : 502;
      throw wrapped;
    }
    let body;
    try { body = await response.json(); } catch {
      const wrapped = new Error('腾讯位置服务返回了无效数据');
      wrapped.status = 502;
      throw wrapped;
    }
    if (Number(body.status) !== 0) throw tencentError(body);
    return body;
  };

  const cached = async (cacheKey, loader) => {
    const item = cache.get(cacheKey);
    const stamp = now();
    if (item && item.expires > stamp) return item.value;
    const value = await loader();
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(cacheKey, { value, expires: stamp + cacheTtlMs });
    return value;
  };

  return {
    suggest: (keyword, { region = '' } = {}) => {
      const q = String(keyword || '').trim();
      const reg = String(region || '').trim();
      return cached(`suggest:${reg}:${q}`, async () => {
        const body = await request(SUGGESTION_URL, {
          keyword: q,
          region: reg,
          region_fix: 1,
          page_size: 8
        });
        return { places: (body.data || []).map(normalizePlace).filter(Boolean) };
      });
    },
    reverse: (lat, lng) => {
      const latitude = Number(lat);
      const longitude = Number(lng);
      return cached(`reverse:${latitude}:${longitude}`, async () => {
        const body = await request(GEOCODER_URL, { location: `${latitude},${longitude}`, get_poi: 0 });
        const result = body.result || {};
        const formatted = result.formatted_addresses || {};
        return {
          name: String(formatted.recommend || formatted.rough || result.address || ''),
          address: String(result.address || ''),
          lat: Number(result.location && result.location.lat) || latitude,
          lng: Number(result.location && result.location.lng) || longitude,
          coordSystem: 'gcj02',
          provider: 'tencent'
        };
      });
    }
  };
}

module.exports = { createTencentMapClient, SUGGESTION_URL, GEOCODER_URL };