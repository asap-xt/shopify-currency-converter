// server/index.js
import '@shopify/shopify-api/adapters/node';  // Нужен адаптер за Node.js среда
import Koa from 'koa';
import Router from 'koa-router';
import dotenv from 'dotenv';
import { Shopify, LATEST_API_VERSION, BillingInterval } from '@shopify/shopify-api';

dotenv.config();
const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES, HOST, HOST_NAME } = process.env;

// Инициализиране на Shopify контекста
Shopify.Context.initialize({
  API_KEY:      SHOPIFY_API_KEY,
  API_SECRET_KEY: SHOPIFY_API_SECRET,
  SCOPES:       SCOPES.split(','),                // напр. "read_orders,write_themes"
  HOST_NAME:    HOST_NAME,                        // без https://
  API_VERSION:  LATEST_API_VERSION,               // последна версия
  IS_EMBEDDED_APP: true,
  SESSION_STORAGE: new Shopify.Session.MemorySessionStorage(), // в паметта – за прод, замени с DB
});

const app = new Koa();
const router = new Router();

// 1) Започваме OAuth flow
router.get('/auth', async (ctx) => {
  const shop = ctx.query.shop;
  if (!shop) ctx.throw(400, 'Missing shop parameter.');
  
  const redirectUrl = await Shopify.Auth.beginAuth(
    ctx.req, ctx.res,
    shop,
    '/auth/callback',
    false // не използваме online tokens
  );
  ctx.redirect(redirectUrl);
  ctx.respond = false; // Koa: пренебрегни автоматичното писане на отговор
});

// 2) OAuth callback: валидация и запазване на session
router.get('/auth/callback', async (ctx) => {
  try {
    const session = await Shopify.Auth.validateAuthCallback(
      ctx.req, ctx.res,
      ctx.query
    );
    // session.shop, session.accessToken
    
    // Запазваме shopOrigin cookie за фронтенд
    ctx.cookies.set('shopOrigin', session.shop, { httpOnly: false });
    
    // 3) Проверка за активен абонамент
    const client = new Shopify.Clients.Graphql(session.shop, session.accessToken);
    const existing = await client.query({
      data: `{
        currentAppInstallation {
          activeSubscriptions { name status }
        }
      }`
    });
    const subs = existing.body.data.currentAppInstallation.activeSubscriptions;
    const isActive = subs.some(s => s.name === 'Monthly Multicurrency' && s.status === 'ACTIVE');

    // 4) Ако няма – създаваме нов с 5‑дневен trial
    if (!isActive) {
      const createSub = await client.query({
        data: {
          query: `
            mutation subscriptionCreate(
              $name: String!, $returnUrl: URL!, $trialDays: Int!,
              $price: MoneyInput!, $interval: BillingInterval!
            ) {
              appSubscriptionCreate(
                name: $name,
                returnUrl: $returnUrl,
                trialDays: $trialDays,
                lineItems: [{
                  plan: { appRecurringPricingDetails: { price: $price, interval: $interval } }
                }]
              ) {
                confirmationUrl
                userErrors { field message }
              }
            }
          `,
          variables: {
            name:       'Monthly Multicurrency',
            returnUrl:  `${HOST}/?billing=success`,
            trialDays:  5,
            price:      { amount: 14.99, currencyCode: 'USD' },
            interval:   BillingInterval.Every30Days
          }
        }
      });
      const { confirmationUrl, userErrors } = createSub.body.data.appSubscriptionCreate;
      if (userErrors.length) {
        console.error('Billing errors:', userErrors);
        ctx.throw(500, 'Billing API error');
      }
      ctx.redirect(confirmationUrl);
      ctx.respond = false;
      return;
    }
    
    // ако абонаментът е активен – отиваме в приложението
    ctx.redirect('/');
    ctx.respond = false;
  } catch (error) {
    console.error('Failed OAuth callback:', error);
    ctx.throw(500, error);
  }
});

// 5) Всички други route-ове – влизане в app-а (нуждаем се от валидна сесия)
router.get('/', async (ctx) => {
  let session;
  try {
    session = await Shopify.Utils.loadCurrentSession(ctx.req, ctx.res);
  } catch (e) {
    // session invalid или липсва – пренасочваме към /auth
  }
  if (!session) {
    const shop = ctx.query.shop || ctx.cookies.get('shopOrigin');
    ctx.redirect(`/auth?shop=${shop}`);
    ctx.respond = false;
    return;
  }

  // Тук сервираме HTML с app-bridge инстанция
  ctx.body = `<!DOCTYPE html>
<html>
  <head>
    <script src="https://unpkg.com/@shopify/app-bridge@3.7.9"></script>
  </head>
  <body>
    <div id="app"></div>
    <script>
      const createApp = window['app-bridge'].default;
      window.app = createApp({
        apiKey: '${SHOPIFY_API_KEY}',
        shopOrigin: '${session.shop}'
      });
    </script>
  </body>
</html>`;
});

app.use(router.routes()).use(router.allowedMethods());

const PORT = parseInt(process.env.PORT, 10) || 8081;
app.listen(PORT, () => console.log(\`> Server listening on ${PORT}\`));
