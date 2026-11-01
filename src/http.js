export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS },
  });
}

export function errorResponse(err) {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message, ...(err.extra || {}) } }, err.status);
  }
  return json({ error: { code: 'server_error', message: 'Something went wrong on our side. Try again.' } }, 500);
}

export async function readJson(request, maxBytes = 16_384) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new ApiError(413, 'too_large', 'Request is too large');
  try {
    const text = await request.text();
    if (text.length > maxBytes) throw new ApiError(413, 'too_large', 'Request is too large');
    const value = text ? JSON.parse(text) : {};
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'bad_json', 'Request body must be a JSON object');
    return value;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'bad_json', 'Request body is not valid JSON');
  }
}
