interface ResponseStatus {
  ok: boolean;
  error?: string;
}

export async function responseStatus(response: Response): Promise<ResponseStatus> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== 'object' || body === null) return { ok: false };
  return {
    ok: 'ok' in body && body.ok === true,
    ...('error' in body && typeof body.error === 'string' ? { error: body.error } : {}),
  };
}

export async function responseError(response: Response): Promise<string | undefined> {
  return (await responseStatus(response)).error;
}
