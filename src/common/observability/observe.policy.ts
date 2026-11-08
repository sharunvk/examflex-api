/**
 * Decides what examflex-api sends to NestJS Observe.
 *
 * PM2 keeps every Nest logger line on stdout. Log forwarding is off, so those
 * lines are not observability events. The free plan counts each real request
 * and each instrumented provider method. Health checks, Swagger, and the
 * per-request plumbing (guards, interceptors, the exception filter) are left
 * out so the 300k allowance is spent on application work.
 *
 * The SDK chooses whether to record a request before it knows the status code,
 * so successful API calls are still traced. Dropping them here would also drop
 * the errors on those routes.
 */

export const OBSERVE_SKIPPED_PROVIDERS = new Set([
  'LoggingInterceptor',
  'TimeoutInterceptor',
  'HttpExceptionFilter',
  'ThrottlerGuard',
  'JwtAuthGuard',
  'OptionalJwtAuthGuard',
  'RolesGuard',
  'ErrorHandlingGuard',
  'JwtStrategy',
  'EnhancedValidationPipe',
]);

export interface ObserveRuntimeOptions {
  appKey: string;
  appSecret: string;
  serviceId: string;
  serviceVersion?: string;
  forwardLogs: false;
  environment: string;
  captureBody: false;
}

export function observeRequestPath(url: string): string {
  const withoutQuery = url.split('?')[0] ?? url;
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

export function shouldIgnoreObserveHttp(req: {
  url?: string;
  method?: string;
}): boolean {
  const path = observeRequestPath(req.url ?? '');
  if (path === '/api/v1/health' || path === '/favicon.ico') {
    return true;
  }
  return path === '/api/docs' || path.startsWith('/api/docs/');
}

export function shouldSkipObserveInstrumentation(instance: unknown): boolean {
  if (instance === null || typeof instance !== 'object') {
    return false;
  }
  const name = (instance as { constructor?: { name?: string } }).constructor
    ?.name;
  return typeof name === 'string' && OBSERVE_SKIPPED_PROVIDERS.has(name);
}

export function observeCredentialsPresent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.OBSERVE_APP_KEY?.trim() && env.OBSERVE_APP_SECRET?.trim());
}

export function observeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'test' || env.JEST_WORKER_ID) {
    return false;
  }
  return observeCredentialsPresent(env);
}

export function buildObserveRuntimeOptions(
  env: NodeJS.ProcessEnv = process.env,
): ObserveRuntimeOptions | null {
  if (!observeEnabled(env)) {
    return null;
  }
  const serviceVersion = env.OBSERVE_SERVICE_VERSION?.trim();
  return {
    appKey: env.OBSERVE_APP_KEY!.trim(),
    appSecret: env.OBSERVE_APP_SECRET!.trim(),
    serviceId: env.INSTANCE_ID?.trim() || 'api',
    ...(serviceVersion ? { serviceVersion } : {}),
    forwardLogs: false,
    environment: env.NODE_ENV?.trim() || 'development',
    captureBody: false,
  };
}
