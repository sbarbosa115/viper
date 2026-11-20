export abstract class AppError extends Error {
  abstract readonly code: string;
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
}
export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED';
}
export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
}
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
}
export class ConflictError extends AppError {
  readonly code = 'CONFLICT';
}
export class DomainRuleViolation extends AppError {
  readonly code = 'RULE_VIOLATION';
}
/** Any PRD error code (see `@app/contracts/errors`), e.g. `new CodedError('EMAIL_TAKEN', '…')`. */
export class CodedError extends AppError {
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}
