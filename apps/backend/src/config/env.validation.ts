/**
 * Fail-fast validation of required environment variables at bootstrap.
 * Keeps startup honest about missing secrets (SEC-002) without embedding any.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const driver = (
    (config.DB_DRIVER as string) || 'sqlite'
  ).toLowerCase();

  const required: string[] = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  if (driver === 'postgres') required.push('DATABASE_URL');

  const missing = required.filter((k) => {
    const v = config[k];
    return v === undefined || v === null || String(v).trim() === '';
  });

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `See .env.example (V2_CONTRACT §6).`,
    );
  }

  if (driver !== 'postgres' && driver !== 'sqlite') {
    throw new Error(`DB_DRIVER must be 'postgres' or 'sqlite', got '${driver}'`);
  }

  return config;
}
