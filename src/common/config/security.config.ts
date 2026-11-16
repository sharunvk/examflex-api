export function parseCorsOrigins(raw?: string | null): string[] {
  if (raw?.trim()) {
    return raw
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CORS_ORIGINS must be set in production (comma-separated absolute origins)',
    );
  }

  // examflex-api :3000, examflex-admin :3001, examflex-app :3002
  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
  ];
}

export function getCorsConfig(corsOriginsEnv?: string | null) {
  return {
    origin: parseCorsOrigins(
      corsOriginsEnv !== undefined ? corsOriginsEnv : process.env.CORS_ORIGINS,
    ),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-API-Key',
    ],
  };
}

export const securityConfig = {
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Needed for development
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  },
  /** Prefer getCorsConfig(configService.get('CORS_ORIGINS')) in bootstrap. */
  get cors() {
    return getCorsConfig();
  },
  rateLimit: {
    ttl: 60000, // 1 minute
    limit: 100, // 100 requests per minute
    skipIf: context => {
      // Skip rate limiting for health checks
      const request = context.switchToHttp().getRequest();
      return request.url === '/api/v1/health';
    },
  },
};
