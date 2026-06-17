export const SLOT_UNAVAILABLE = "SLOT_UNAVAILABLE";
export const IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED";
export const IDEMPOTENCY_KEY_REQUIRED = "IDEMPOTENCY_KEY_REQUIRED";
export const IDEMPOTENCY_KEY_INVALID = "IDEMPOTENCY_KEY_INVALID";

export class AppointmentConflictError extends Error {
  readonly code = SLOT_UNAVAILABLE;
  readonly status = 409;

  constructor(message = "Este horario nao esta mais disponivel.") {
    super(message);
  }
}

export class IdempotencyKeyReusedError extends Error {
  readonly code = IDEMPOTENCY_KEY_REUSED;
  readonly status = 409;

  constructor(message = "A chave de idempotencia ja foi utilizada com outra requisicao.") {
    super(message);
  }
}

export class IdempotencyKeyRequiredError extends Error {
  readonly code = IDEMPOTENCY_KEY_REQUIRED;
  readonly status = 400;

  constructor(message = "Envie o header Idempotency-Key para confirmar o agendamento.") {
    super(message);
  }
}

export class IdempotencyKeyInvalidError extends Error {
  readonly code = IDEMPOTENCY_KEY_INVALID;
  readonly status = 400;

  constructor(message = "A chave de idempotencia deve ser um UUID valido.") {
    super(message);
  }
}
