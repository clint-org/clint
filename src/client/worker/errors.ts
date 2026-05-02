export type SupabaseRpcError = {
  code?: string;
  message?: string;
  httpStatus?: number;
};

export type ErrorMapping = {
  status: number;
  body: { error: string };
};

export function mapSupabaseError(err: SupabaseRpcError): ErrorMapping {
  if (err.httpStatus === 401) {
    return { status: 401, body: { error: 'unauthenticated' } };
  }
  switch (err.code) {
    case '42501':
      return { status: 403, body: { error: 'forbidden' } };
    case 'P0002':
      return { status: 404, body: { error: 'not_found' } };
    case '22023':
      return { status: 422, body: { error: err.message ?? 'invalid' } };
    default:
      return { status: 500, body: { error: 'internal' } };
  }
}

export function errorResponse(
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
