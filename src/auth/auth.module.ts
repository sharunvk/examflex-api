/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { Msg91Service } from './services/msg91.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OtpIdentityStrategy } from './identity/otp-identity.strategy';
import { GoogleIdentityStrategy } from './identity/google-identity.strategy';
import { GoogleIdTokenVerifier } from './identity/google-id-token.verifier';
import { GoogleCodeExchangeService } from './identity/google-code-exchange.service';
import { StudentAccountResolver } from './identity/student-account.resolver';
import { StudentSessionService } from './session/student-session.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '7d',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    Msg91Service,
    OtpIdentityStrategy,
    GoogleIdTokenVerifier,
    GoogleCodeExchangeService,
    GoogleIdentityStrategy,
    StudentAccountResolver,
    StudentSessionService,
    JwtStrategy,
  ],
  exports: [AuthService, Msg91Service, JwtModule, PassportModule],
})
export class AuthModule {}
