import { INestApplication } from '@nestjs/common';
import { AbstractHttpAdapter, APP_GUARD } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerStorage, ThrottlerStorageService } from '../src';
import { ControllerModule } from './app/controllers/controller.module';
import { httPromise } from './utility/httpromise';

describe.each`
  adapter                 | adapterName
  ${new ExpressAdapter()} | ${'Express'}
  ${new FastifyAdapter()} | ${'Fastify'}
`('$adapterName Throttler', ({ adapter }: { adapter: AbstractHttpAdapter }) => {
  let app: INestApplication;
  let storageService: ThrottlerStorageService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ControllerModule],
      providers: [
        {
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication(adapter);
    storageService = moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('controllers', () => {
    let appUrl: string;
    beforeAll(async () => {
      appUrl = await app.getUrl();
    });

    /**
     * Tests for setting `@Throttle()` at the method level and for ignore routes
     */
    describe('AppController', () => {
      it('GET /ignored', async () => {
        const response = await httPromise(appUrl + '/ignored');
        expect(response.data).toEqual({ ignored: true });
        expect(response.headers).not.toMatchObject({
          'x-ratelimit-limit': '2',
          'x-ratelimit-remaining': '1',
          'x-ratelimit-reset': /\d+/,
        });
      });
      it('GET /ignore-user-agents', async () => {
        const response = await httPromise(appUrl + '/ignore-user-agents', 'GET', {
          'user-agent': 'throttler-test/0.0.0',
        });
        expect(response.data).toEqual({ ignored: true });
        expect(response.headers).not.toMatchObject({
          'x-ratelimit-limit': '2',
          'x-ratelimit-remaining': '1',
          'x-ratelimit-reset': /\d+/,
        });
      });
      it('GET /', async () => {
        const response = await httPromise(appUrl + '/');
        expect(response.data).toEqual({ success: true });
        expect(response.headers).toMatchObject({
          'x-ratelimit-limit': '2',
          'x-ratelimit-remaining': '1',
          'x-ratelimit-reset': /\d+/,
        });
      });
    });
    /**
     * Tests for setting `@Throttle()` at the class level and overriding at the method level
     */
    describe('LimitController', () => {
      it.each`
        method   | url          | limit
        ${'GET'} | ${''}        | ${2}
        ${'GET'} | ${'/higher'} | ${5}
      `(
        '$method $url',
        async ({ method, url, limit }: { method: 'GET'; url: string; limit: number }) => {
          for (let i = 0; i < limit; i++) {
            const response = await httPromise(appUrl + '/limit' + url, method);
            expect(response.data).toEqual({ success: true });
            expect(response.headers).toMatchObject({
              'x-ratelimit-limit': limit.toString(),
              'x-ratelimit-remaining': (limit - (i + 1)).toString(),
              'x-ratelimit-reset': /\d+/,
            });
          }
          const errRes = await httPromise(appUrl + '/limit' + url, method);
          expect(errRes.data).toMatchObject({ statusCode: 429, message: /ThrottlerException/ });
          expect(errRes.headers).toMatchObject({
            'retry-after': /\d+/,
          });
          expect(errRes.status).toBe(429);
        },
      );
    });
    /**
     * Tests for setting throttle values at the `forRoot` level
     */
    describe('DefaultController', () => {
      it('GET /default', async () => {
        const response = await httPromise(appUrl + '/default');
        expect(response.data).toEqual({ success: true });
        expect(response.headers).toMatchObject({
          'x-ratelimit-limit': '5',
          'x-ratelimit-remaining': '4',
          'x-ratelimit-reset': /\d+/,
        });
      });
    });

    /**
     * Tests for setting `@Throttles()` at the method level and for ignore routes
     */
    describe('MultipleThrottlesController', () => {
      beforeEach(() => {
        // clear storage
        Object.keys(storageService.storage).forEach((key) => delete storageService.storage[key]);
      });
      it('GET /multiple', async () => {
        const response = await httPromise(appUrl + '/multiple');
        expect(response.data).toEqual({ success: true });
        expect(response.headers).toMatchObject({
          'x-ratelimit-limit': '3',
          'x-ratelimit-remaining': '2',
          'x-ratelimit-reset': /\d+/,
        });
      });
      it('GET /multiple', async () => {
        for (let i = 0; i < 4; i++) {
          await httPromise(appUrl + '/multiple');
          await new Promise((r) => setTimeout(r, 2000));
        }
        const response = await httPromise(appUrl + '/multiple');
        expect(response.data).toEqual({ success: true });
        expect(response.headers).toMatchObject({
          'x-ratelimit-limit': '5',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': /\d+/,
        });
      }, 10000);
      it('POST /multiple/ignore-custom', async () => {
        const response = await httPromise(
          appUrl + '/multiple/ignore-custom',
          'POST',
          {},
          { ignore: true },
        );
        expect(response.data).toEqual({ ignored: true });
        expect(response.headers).not.toMatchObject({
          'x-ratelimit-limit': '3',
          'x-ratelimit-remaining': '2',
          'x-ratelimit-reset': /\d+/,
        });
      });
      it('POST /multiple/method-override', async () => {
        const response = await httPromise(appUrl + '/multiple/method-override');
        expect(response.data).toEqual({ success: true });
        expect(response.headers).toMatchObject({
          'x-ratelimit-limit': '1',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': /\d+/,
        });
      });
    });
  });
});
