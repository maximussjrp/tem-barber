export const SLOT_UNAVAILABLE = "SLOT_UNAVAILABLE";
export const IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED";
export const IDEMPOTENCY_KEY_REQUIRED = "IDEMPOTENCY_KEY_REQUIRED";
export const IDEMPOTENCY_KEY_INVALID = "IDEMPOTENCY_KEY_INVALID";
export const INVALID_SERVICE_SELECTION = "INVALID_SERVICE_SELECTION";
export const PROFESSIONAL_NOT_AVAILABLE = "PROFESSIONAL_NOT_AVAILABLE";
export const PROFESSIONAL_SERVICE_MISMATCH = "PROFESSIONAL_SERVICE_MISMATCH";
export const FIT_IN_REASON_REQUIRED = "FIT_IN_REASON_REQUIRED";
export const FIT_IN_NOT_ALLOWED = "FIT_IN_NOT_ALLOWED";
export const SCHEDULE_BLOCK_CONFLICT = "SCHEDULE_BLOCK_CONFLICT";

export class ScheduleBlockConflictApptError extends Error {
  readonly code = SCHEDULE_BLOCK_CONFLICT;
  readonly status = 409;

  constructor(message = "O profissional está indisponível neste período por um bloqueio de agenda.") {
    super(message);
    this.name = "ScheduleBlockConflictApptError";
  }
}

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

export class InvalidServiceSelectionError extends Error {
  readonly code = INVALID_SERVICE_SELECTION;
  readonly status = 400;

  constructor(message = "Um ou mais servicos invalidos.") {
    super(message);
  }
}

export class ProfessionalNotAvailableError extends Error {
  readonly code = PROFESSIONAL_NOT_AVAILABLE;
  readonly status = 404;

  constructor(message = "Barbeiro nao disponivel.") {
    super(message);
  }
}

export class ProfessionalServiceMismatchError extends Error {
  readonly code = PROFESSIONAL_SERVICE_MISMATCH;
  readonly status = 422;

  constructor(message = "Profissional indisponivel para um ou mais servicos selecionados.") {
    super(message);
  }
}

export class FitInReasonRequiredError extends Error {
  readonly code = FIT_IN_REASON_REQUIRED;
  readonly status = 400;

  constructor(message = "Informe o motivo do encaixe.") {
    super(message);
  }
}

export class FitInNotAllowedError extends Error {
  readonly code = FIT_IN_NOT_ALLOWED;
  readonly status = 403;

  constructor(message = "Somente OWNER ou MANAGER podem criar encaixes.") {
    super(message);
  }
}
