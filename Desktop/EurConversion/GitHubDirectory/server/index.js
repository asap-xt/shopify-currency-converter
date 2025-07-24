// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import session from 'koa-session';
import Router from 'koa-router';
import getRawBody from 'raw-body';
import { shopifyApi, LATEST_API_VERSION, BillingInterval } from '@shopify/shopify-api';

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SCOPES,
  HOST,
  HOST_NAME
} = process.env;

// Initialize Shopify API client
const Shopify = shopifyApi({
  apiKey:       SHOPIFY_API_KEY,
  apiSecretKey: SHOPIFY_API_SECRET,
  scopes:       SCOPES.split(','),
  hostName:     HOST_NAME,
  apiVersion:   LATEST_API_VERSION,
  isEmbeddedApp:true,
  sessionStorage: new Shopify.Session.MemorySessionStorage()
});

const app = new Koa();
app.keys = [SHOPIFY_API_SECRET];
app.use(session(app));

const router = new Router();

// Webhook handler
router.post('/webhooks', async (ctx) => {
  const rawBody = await getRawBody(ctx.req);
  try {
    await Shopify.Webhooks.Registry.process({
      rawBody,
      rawRequest: ctx.req,
      rawResponse: ctx.res,
    });
    ctx.status = 200;
  } catch (err) {
    console.error('❌ Webhook failed', err);
    ctx.status = 500;
  }
});

// OAuth start
router.get('/auth', async (ctx) => {
  const shop = ctx.query.shop;
  if (!shop) ctx.throw(400, 'Missing shop parameter');
  const redirectUrl = await Shopify.auth.beginAuth(
    ctx.req, ctx.res, shop, '/auth/callback', false
  );
  ctx.redirect(redirectUrl);
  ctx.respond = false;
});

// OAuth callback & billing
router.get('/auth/callback', async (ctx) => {
  const session = await Shopify.auth.validateAuthCallback(
    ctx.req, ctx.res, ctx.query
  );
  ctx.cookies.set('shopOrigin', session.shop, { httpOnly: false });

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

  if (!isActive) {
    const response = await client.query({
      data: {
        query: `
          mutation subscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int!, $price: MoneyInput!, $interval: BillingInterval!) {
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
          name:      'Monthly Multicurrency',
          returnUrl: `${HOST}/?billing=success`,
          trialDays: 5,
          price:     { amount: 14.99, currencyCode: 'USD' },
          interval:  BillingInterval.Every30Days
        }
      }
    });
    const { confirmationUrl, userErrors } = response.body.data.appSubscriptionCreate;
    if (userErrors.length) {
      console.error('Billing errors', userErrors);
      ctx.throw(500, 'Billing API error');
    }
    ctx.redirect(confirmationUrl);
    ctx.respond = false;
    return;
  }

  ctx.redirect('/');
  ctx.respond = false;
});

// App Bridge entrypoint
router.get('/', async (ctx) => {
  try {
    const sessionId = await Shopify.Session.getCurrentId({
      isOnline:   false,
      rawRequest: ctx.req,
      rawResponse: ctx.res
    });
    const session = await Shopify.Session.decode(sessionId);

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
  } catch {
    const shop = ctx.query.shop || ctx.cookies.get('shopOrigin');
    ctx.redirect(\`/auth?shop=\${shop}\`);
    ctx.respond = false;
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = parseInt(process.env.PORT, 10) || 8081;
app.listen(PORT, function() {
  console.log('> Server listening on ' + PORT);
});
