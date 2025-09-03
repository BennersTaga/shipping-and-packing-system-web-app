export type EnvKey = 'test' | 'prod';

export function defaultEnv(): EnvKey {
  return process.env.VERCEL_ENV === 'production' ? 'prod' : 'test';
}

export function pickGasBaseUrl(env: EnvKey): string | undefined {
  if (env === 'prod') return process.env.GAS_WEBAPP_PROD_URL;
  return process.env.GAS_WEBAPP_TEST_URL || process.env.GAS_WEBAPP_URL;
}
