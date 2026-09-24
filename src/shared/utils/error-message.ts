/**
 * Loggable message for an unknown error. Falls back to the error code because
 * Node reports multi-address connect failures as an AggregateError with an
 * empty message.
 */
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.message) return err.message;
  const { code } = err as { code?: unknown };
  return typeof code === 'string' ? code : err.name;
}

/**
 * Error class, plus the Postgres SQLSTATE when there is one. For logs where
 * the message itself could quote data (driver errors can include values).
 */
export function errorClass(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const code = (err as { driverError?: { code?: unknown } }).driverError?.code;
  return typeof code === 'string' ? `${err.name}(${code})` : err.name;
}
