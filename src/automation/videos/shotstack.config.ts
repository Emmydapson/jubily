const DEFAULT_SHOTSTACK_EDIT_BASE_URL = 'https://api.shotstack.io/edit/v1';

export function normalizeShotstackEditBaseUrl(
  baseUrl = process.env.SHOTSTACK_BASE_URL,
) {
  const normalized = String(baseUrl || DEFAULT_SHOTSTACK_EDIT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  if (!normalized) return DEFAULT_SHOTSTACK_EDIT_BASE_URL;
  return normalized.endsWith('/render')
    ? normalized.slice(0, -'/render'.length)
    : normalized;
}

export function shotstackRenderUrl(baseUrl = process.env.SHOTSTACK_BASE_URL) {
  return `${normalizeShotstackEditBaseUrl(baseUrl)}/render`;
}

export function shotstackRenderStatusUrl(
  renderId: string,
  baseUrl = process.env.SHOTSTACK_BASE_URL,
) {
  return `${shotstackRenderUrl(baseUrl)}/${encodeURIComponent(renderId)}`;
}

export function shotstackServeBaseUrl(
  baseUrl = process.env.SHOTSTACK_BASE_URL,
) {
  return normalizeShotstackEditBaseUrl(baseUrl).replace('/edit/', '/serve/');
}

export function shotstackRenderAssetUrl(
  renderId: string,
  baseUrl = process.env.SHOTSTACK_BASE_URL,
) {
  return `${shotstackServeBaseUrl(baseUrl)}/assets/render/${encodeURIComponent(renderId)}`;
}

export function shotstackApiKey() {
  const key = String(process.env.SHOTSTACK_API_KEY || '').trim();
  if (!key) throw new Error('Missing SHOTSTACK_API_KEY');
  return key;
}

export function shotstackHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-api-key': shotstackApiKey(),
  };
}
