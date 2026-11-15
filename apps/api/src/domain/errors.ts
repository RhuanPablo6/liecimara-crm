export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} não encontrado: ${id}`, 404);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Permissão insuficiente') {
    super('FORBIDDEN', message, 403);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Não autenticado') {
    super('UNAUTHORIZED', message, 401);
  }
}

/** Falha transitória: o job deve ser reprocessado com backoff. */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** Falha definitiva: não adianta tentar novamente. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}
