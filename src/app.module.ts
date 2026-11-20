import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { FeedbackModule } from './feedback/feedback.module';
import { CounselingModule } from './counseling/counseling.module';
import { AuthModule } from './auth/auth.module';
import { MockTestsModule } from './mock-tests/mock-tests.module';
import { MockTestAttemptsModule } from './mock-test-attempts/mock-test-attempts.module';
import { MistakeBookModule } from './mistake-book/mistake-book.module';
import { FullMockTestsModule } from './full-mock-tests/full-mock-tests.module';
import { SprintTestsModule } from './sprint-tests/sprint-tests.module';
import { CategoriesModule } from './categories/categories.module';
import { ExamsModule } from './exams/exams.module';
import { ExamGroupsModule } from './exam-groups/exam-groups.module';
import { TopicsModule } from './topics/topics.module';
import { SubjectsModule } from './subjects/subjects.module';
import { TagsModule } from './tags/tags.module';
import { QuestionsModule } from './questions/questions.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { SearchModule } from './search/search.module';
import { ImportModule } from './imports/import.module';
import { CurrentAffairsModule } from './current-affairs/current-affairs.module';
import { EquationBookModule } from './equation-book/equation-book.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { AnalysisModule } from './analysis/analysis.module';
import { TodayModule } from './today/today.module';
import { InstanceConfigModule } from './instance-config/instance-config.module';
import { ValidationModule } from './common/validators/validation.module';
import { AwsModule } from './aws/aws.module';
import { RedisModule } from './redis/redis.module';
import { CommerceModule } from './commerce/commerce.module';
import { CommerceAuditModule } from './commerce-audit/commerce-audit.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { AccessModule } from './access/access-control.module';
import { ProductsModule } from './products/products.module';
import { OffersModule } from './offers/offers.module';
import { CatalogModule } from './catalog/catalog.module';
import { TaxModule } from './tax/tax.module';
import { PaymentsModule } from './payments/payments.module';
import { OrdersModule } from './orders/orders.module';
import { AccountingModule } from './accounting/accounting.module';
import { CommerceHealthModule } from './commerce-health/commerce-health.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { InvoicesModule } from './invoices/invoices.module';
import { MetaModule } from './meta/meta.module';
import { RefundsModule } from './refunds/refunds.module';
import { securityConfig } from './common/config/security.config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { createObserveRootModule } from './common/observability/observe.config';

const observeRootModule = createObserveRootModule();

@Module({
  imports: [
    // Global configuration module
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // MongoDB connection with async configuration
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const mongoUri = configService.get<string>('MONGODB_URI');
        console.log(
          '🔍 MongoDB URI from config:',
          mongoUri ? 'Found' : 'NOT FOUND',
        );

        if (!mongoUri) {
          console.error(
            '❌ MONGODB_URI is not defined in environment variables',
          );
          console.log(
            '📋 Available environment variables:',
            Object.keys(process.env).filter(key => key.startsWith('MONGODB')),
          );
          throw new Error('MONGODB_URI environment variable is required');
        }

        return {
          uri: mongoUri,
          connectionFactory: connection => {
            connection.on('connected', () => {
              console.log('✅ MongoDB connected successfully');
            });
            connection.on('error', error => {
              console.error('❌ MongoDB connection error:', error);
            });
            connection.on('disconnected', () => {
              console.log('🔌 MongoDB disconnected');
            });
            return connection;
          },
        };
      },
      inject: [ConfigService],
    }),
    // Rate limiting configuration
    ThrottlerModule.forRoot([securityConfig.rateLimit]),
    CommerceModule,
    ...(observeRootModule ? [observeRootModule] : []),
    // AWS services (Global module)
    AwsModule,
    RedisModule,
    // Custom validation module
    ValidationModule,
    UsersModule,
    FeedbackModule,
    CounselingModule,
    AuthModule,
    MockTestsModule,
    MockTestAttemptsModule,
    MistakeBookModule,
    FullMockTestsModule,
    SprintTestsModule,
    CategoriesModule,
    ExamsModule,
    ExamGroupsModule,
    TopicsModule,
    SubjectsModule,
    TagsModule,
    QuestionsModule,
    AnalyticsModule,
    AdminDashboardModule,
    AdminUsersModule,
    SearchModule,
    ImportModule,
    CurrentAffairsModule,
    EquationBookModule,
    RecommendationsModule,
    AnalysisModule,
    TodayModule,
    InstanceConfigModule,
    CommerceAuditModule,
    EntitlementsModule,
    AccessModule,
    ProductsModule,
    OffersModule,
    CatalogModule,
    TaxModule,
    PaymentsModule,
    OrdersModule,
    CommerceHealthModule,
    AccountingModule,
    WebhooksModule,
    InvoicesModule,
    RefundsModule,
    MetaModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global exception filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global logging interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global timeout interceptor (30 seconds; skipped via @SkipTimeout())
    {
      provide: APP_INTERCEPTOR,
      useClass: TimeoutInterceptor,
    },
    // Global rate limiting guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
