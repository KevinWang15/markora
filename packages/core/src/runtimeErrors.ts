export function createCleanupError(message: string, errors: readonly unknown[]) {
  const error = new Error(message) as Error & { errors: readonly unknown[] };
  error.name = "AggregateError";
  error.errors = Object.freeze([...errors]);
  return error;
}

export function throwCollectedErrors(message: string, errors: readonly unknown[]) {
  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw createCleanupError(message, errors);
  }
}

