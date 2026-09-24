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
