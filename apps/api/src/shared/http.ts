// Cliente HTTP mínimo (porta), para permitir simular a Meta nos testes.

export interface HttpResponse {
  status: number;
  json: unknown;
}

export interface HttpClient {
  request(url: string, init: { method: 'GET' | 'POST' | 'DELETE'; headers?: Record<string, string>; body?: unknown }): Promise<HttpResponse>;
}

export class FetchHttpClient implements HttpClient {
  constructor(private readonly timeoutMs = 20_000) {}

  async request(url: string, init: { method: 'GET' | 'POST' | 'DELETE'; headers?: Record<string, string>; body?: unknown }): Promise<HttpResponse> {
    const res = await fetch(url, {
      method: init.method,
      headers: { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json };
  }
}

/** Erro da Graph API com classificação de transitoriedade. */
export class GraphApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: number | null,
    public readonly subcode: number | null,
    public readonly transient: boolean,
  ) {
    super(message);
    this.name = 'GraphApiError';
  }

  static from(status: number, body: any): GraphApiError {
    const e = body?.error ?? {};
    // Códigos de limite/indisponibilidade da Graph API: 1, 2, 4, 17, 32, 341, 613, 80000-80014
    const rateOrTransient = [1, 2, 4, 17, 32, 341, 613].includes(e.code) || (e.code >= 80000 && e.code <= 80014);
    const transient = status >= 500 || status === 429 || rateOrTransient || e.is_transient === true;
    return new GraphApiError(e.message ?? `HTTP ${status}`, status, e.code ?? null, e.error_subcode ?? null, transient);
  }
}
