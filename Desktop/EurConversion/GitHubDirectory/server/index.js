// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import session from 'koa-session';
import Router from 'koa-router';
import getRawBody from 'raw-body';
// ПРОМЯНА 1: Импортираме 'Session' директно от пакета
import { shopifyApi, LATEST_API_VERSION, BillingInterval, Session } from '@shopify/shopify-api';

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SCOPES,
  HOST,
  HOST_NAME
} = process.env;

// Инициализация на Shopify API клиента
const Shopify = shopifyApi({
  apiKey:         SHOPIFY_API_KEY,
  apiSecretKey:   SHOPIFY_API_SECRET,
  scopes:         SCOPES.split(','),
  hostName:       HOST_NAME,
  apiVersion:     LATEST_API_VERSION,
  isEmbeddedApp:  true,
  // ПРОМЯНА 2: Използваме импортирания 'Session' обект
  sessionStorage: new Session.MemorySessionStorage()
});

const app = new Koa();
app.keys = [SHOPIFY_API_SECRET];
// Важна забележка: koa-session изисква сесията да е зададена преди рутера
app.use(session({ sameSite: 'none', secure: true }, app));
app.use(Shopify.auth.begin());

const router = new Router();

// Webhook endpoint
router.post('/api/webhooks', async (ctx) => {
  try {
    await Shopify.Webhooks.Registry.process(ctx.req, ctx.res);
    console.log('Webhook processed successfully');
  } catch (error) {
    console.error('Failed to process webhook:', error);
  }
});

// OAuth callback + billing
router.get('/api/auth/callback', async (ctx) => {
  try {
    const session = await Shopify.auth.callback(ctx.req, ctx.res, ctx.query);
    ctx.cookies.set('shopOrigin', session.shop, { httpOnly: false, secure: true, sameSite: 'none' });

    // Проверка за билинга
    const client = new Shopify.Clients.Graphql({ session });
    const { body } = await client.query({
      data: `{
        currentAppInstallation {
          activeSubscriptions { name status }
        }
      }`
    });
    
    const subs = body.data.currentAppInstallation.activeSubscriptions;
    const isActive = subs.some(s => s.name === 'Monthly Multicurrency' && s.status === 'ACTIVE');

    if (!isActive) {
      const { body: billingBody } = await client.query({
        data: {
          query: `
            mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $trialDays: Int) {
              appSubscriptionCreate(name: $name, lineItems: $lineItems, returnUrl: $returnUrl, trialDays: $trialDays) {
                userErrors { field message }
                confirmationUrl
              }
            }
          `,
          variables: {
            name: "Monthly Multicurrency",
            returnUrl: `${HOST}/?shop=${session.shop}`,
            trialDays: 5,
            lineItems: [{
              plan: {
                appRecurringPricingDetails: {
                  price: { amount: 14.99, currencyCode: 'USD' },
                  interval: BillingInterval.Every30Days
                }
              }
            }]
          }
        }
      });

      const { confirmationUrl, userErrors } = billingBody.data.appSubscriptionCreate;
      if (userErrors && userErrors.length > 0) {
        console.error('Billing errors:', userErrors);
        ctx.throw(500, 'Billing API error');
        return;
      }
      ctx.redirect(confirmationUrl);
      return;
    }
    // Пренасочване към фронтенда на приложението
    ctx.redirect(`/?shop=${session.shop}`);
  } catch (error) {
    console.error('Auth callback error:', error);
    ctx.redirect(`/api/auth?shop=${ctx.query.shop}`);
  }
});


// App Bridge entry
router.get('(/)', async (ctx) => {
    // Тази част обикновено се обслужва от фронтенд, тук е само пример
    const shop = ctx.query.shop;
    if (!shop) {
        ctx.body = 'Missing shop parameter.';
        ctx.status = 400;
        return;
    }
    
    ctx.body = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>My Shopify App</title>
            <script src="https://unpkg.com/@shopify/app-bridge@latest"></script>
            <script>
                const app = AppBridge.createApp({
                    apiKey: '${SHOPIFY_API_KEY}',
                    host: new URL(window.location.href).searchParams.get('host'),
                });
            </script>
        </head>
        <body>
            <h1>Welcome to the app!</h1>
            <p>Shop: ${shop}</p>
        </body>
        </html>
    `;
    ctx.set('Content-Type', 'text/html');
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = parseInt(process.env.PORT, 10) || 8081;
app.listen(PORT, () => {
  console.log(`> Server listening on port ${PORT}`);
});