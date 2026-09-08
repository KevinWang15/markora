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

/** One disposal order for both editor entries, including failed construction.
 * Each owner gets its cleanup attempt even if an earlier owner throws. */
export function disposeEditorRuntime(options: {
  message: string;
  errors?: unknown[];
  begin(errors: unknown[]): void;
  beforeView: readonly (() => void)[];
  assembly: {
    beginDestroy(): void;
    cleanupSetup(): readonly unknown[];
    cleanupAssembly(): readonly unknown[];
  };
  destroyView(errors: unknown[]): void;
  afterView?: readonly (() => void)[];
  finalize: readonly ((errors: unknown[]) => void)[];
}) {
  const errors = options.errors ?? [];
  for (const cleanup of [
    () => options.begin(errors),
    () => options.assembly.beginDestroy(),
    ...options.beforeView,
    () => { errors.push(...options.assembly.cleanupSetup()); },
    () => options.destroyView(errors),
    ...options.afterView ?? [],
    () => { errors.push(...options.assembly.cleanupAssembly()); },
    ...options.finalize.map(finalize => () => finalize(errors)),
  ]) {
    try { cleanup(); } catch (error) { errors.push(error); }
  }
  throwCollectedErrors(options.message, errors);
}
