import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllowIncompleteProfile } from '../auth/decorators/allow-incomplete-profile.decorator';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

@Controller('probe')
@UseGuards(JwtAuthGuard)
class ProbeController {
  @Get('gated')
  gated() {
    return { ok: true };
  }

  @Get('open')
  @AllowIncompleteProfile()
  open() {
    return { ok: true };
  }
}

/**
 * Boots a real Nest app (real DI, real passport-jwt, real guard, real error
 * filter) so we know the guard actually receives its Reflector and the 403 has
 * the shape clients rely on. The user lookup is the only thing faked.
 */
describe('profile gate (integration)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  const users: Record<string, Record<string, unknown>> = {
    incomplete: {
      id: 'incomplete',
      role: 'user',
      isActive: true,
      profileComplete: false,
    },
    complete: {
      id: 'complete',
      role: 'user',
      isActive: true,
      profileComplete: true,
    },
    admin: {
      id: 'admin',
      role: 'admin',
      isActive: true,
      profileComplete: false,
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({ secret: 'integration-secret' }),
      ],
      controllers: [ProbeController],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'JWT_SECRET' ? 'integration-secret' : undefined,
          },
        },
        {
          provide: AuthService,
          useValue: {
            validateJwtPayload: (payload: { sub: string }) =>
              users[payload.sub],
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const token = (sub: string) => jwt.sign({ sub, role: users[sub]?.role });
  const get = (path: string, sub?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return sub ? req.set('Authorization', `Bearer ${token(sub)}`) : req;
  };

  it('blocks an unfinished student on a normal route with a clear, machine-readable 403', async () => {
    const res = await get('/probe/gated', 'incomplete');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('PROFILE_INCOMPLETE');
    expect(res.body.message).toBe('Complete your profile to continue.');
  });

  it('lets an unfinished student reach a route that opts out', async () => {
    const res = await get('/probe/open', 'incomplete');
    expect(res.status).toBe(200);
  });

  it('lets a finished student through everywhere', async () => {
    expect((await get('/probe/gated', 'complete')).status).toBe(200);
    expect((await get('/probe/open', 'complete')).status).toBe(200);
  });

  it('never gates admins', async () => {
    expect((await get('/probe/gated', 'admin')).status).toBe(200);
  });

  it('still answers 401 (not 403) with no token or a bad token', async () => {
    expect((await get('/probe/gated')).status).toBe(401);
    const bad = await request(app.getHttpServer())
      .get('/probe/gated')
      .set('Authorization', 'Bearer not.a.token');
    expect(bad.status).toBe(401);
  });
});
