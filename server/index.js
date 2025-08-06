// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import Router from 'koa-router';
import koaSession from 'koa-session';
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SCOPES,       // например "read_products,write_orders"
  HOST,         // например "https://my-app.example.com"
  PORT = 3000
} = process.env;

const shopify = shopifyApi({
  apiKey:        SHOPIFY_API_KEY,
  apiSecretKey:  SHOPIFY_API_SECRET,
  scopes:        SCOPES.split(','),
  hostName:      HOST.replace(/^https?:\/\//, ''),
  apiVersion:    LATEST_API_VERSION,
  isEmbeddedApp: true,
  auth:          { useOnlineTokens: true },  // online tokens, ако искате offline – сменете на false
  // sessionStorage: // по подразбиране е MemorySessionStorage от adapter-а
});

const app = new Koa();
app.keys = [SHOPIFY_API_SECRET];
app.use(koaSession({ sameSite: 'none', secure: true }, app));

const router = new Router();

// ─── OAuth ────────────────────────────────────────────────────
router.get('/auth', async (ctx) => {
  const shop = ctx.query.shop;
  const redirectUrl = await shopify.auth.beginAuth(
    ctx.req, ctx.res, shop, '/auth/callback', false
  );
  ctx.redirect(redirectUrl);
});
router.get('/auth/callback', async (ctx) => {
  const session = await shopify.auth.validateAuthCallback(
    ctx.req, ctx.res, ctx.query
  );
  // след валидиране сесията е записана в storage
  ctx.redirect(`/api/billing/create?shop=${session.shop}`);
});

// ─── CREATE BILLING SUBSCRIPTION ──────────────────────────────
router.get('/api/billing/create', async (ctx) => {
  // 1) взимаме ID на текущата сесия (online)
  const sessionId = await shopify.session.getCurrentId({
    rawRequest:  ctx.req,
    rawResponse: ctx.res,
    isOnline:    true
  });
  if (!sessionId) {
    return ctx.redirect(`/auth?shop=${ctx.query.shop}`);
  }
  // 2) зареждаме сесията от storage
  const session = await shopify.config.sessionStorage.loadSession(sessionId);
  if (!session) throw new Error('No Shopify session found');

  const client = new shopify.clients.Graphql({ session });

  // GraphQL мутация за recurring charge + пробен период
  const MUTATION = `
    mutation appSubscriptionCreate(
      $name: String!,
      $returnUrl: URL!,
      $trialDays: Int!,
      $test: Boolean!
    ) {
      appSubscriptionCreate(
        name: $name,
        returnUrl: $returnUrl,
        trialDays: $trialDays,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: 14.99, currencyCode: USD },
                interval: EVERY_30_DAYS
              }
            }
          }
        ],
        test: $test
      ) {
        confirmationUrl
        userErrors { field message }
      }
    }
  `;
  const vars = {
    name:      "Basic Plan",
    returnUrl: `${HOST}/api/billing/callback`,
    trialDays: 5,
    test:      process.env.NODE_ENV !== 'production'
  };

  const resp = await client.query({ data: { query: MUTATION, variables: vars } });
  const errs = resp.body.data.appSubscriptionCreate.userErrors;
  if (errs.length) ctx.throw(400, errs.map(e => e.message).join('; '));

  ctx.redirect(resp.body.data.appSubscriptionCreate.confirmationUrl);
});

// ─── BILLING CALLBACK ─────────────────────────────────────────
router.get('/api/billing/callback', async (ctx) => {
  // отново charge ID-то идва в query: ?id=<subscriptionId>
  const subscriptionId = ctx.query.id;
  // пак зареждаме сесията
  const sessionId = await shopify.session.getCurrentId({
    rawRequest:  ctx.req,
    rawResponse: ctx.res,
    isOnline:    true
  });
  const session = sessionId
    ? await shopify.config.sessionStorage.loadSession(sessionId)
    : null;
  if (!session) throw new Error('No Shopify session on billing callback');

  const client = new shopify.clients.Graphql({ session });
  const QUERY = `
    query getSubscription($id: ID!) {
      node(id: $id) {
        ... on AppSubscription {
          id
          status
          currentPeriodEnd
        }
      }
    }
  `;
  const { body } = await client.query({ data: { query: QUERY, variables: { id: subscriptionId } } });
  const subscription = body.data.node;

  // TODO: запиши subscription в твоята DB: shop + subscription
  // await saveSub({ shop: session.shop, subscription });

  ctx.redirect(`/?billing=success`);
});

// ─── FALLBACK ROUTE ("/") ──────────────────────────────────────
router.get('/', async (ctx) => {
  // при зареждане във iframe Shopify изпраща shop query param
  const shop = ctx.query.shop;
  // ако няма валидна сесия, пак към /auth
  const sessionId = await shopify.session.getCurrentId({
    rawRequest:  ctx.req,
    rawResponse: ctx.res,
    isOnline:    true
  });
  if (!sessionId) {
    return ctx.redirect(`/auth?shop=${shop}`);
  }
  
  // Ако има сесия, показваме главната страница
  ctx.type = 'html';
  ctx.body = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>BGN/EUR Price Display</title>
        <meta name="shopify-api-key" content="${SHOPIFY_API_KEY}" />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #fafafa;
            color: #202223;
          }
          .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            padding: 40px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .header {
            text-align: center;
            margin-bottom: 40px;
          }
          .header h1 {
            margin: 0 0 12px 0;
            font-size: 32px;
            font-weight: 500;
            color: #202223;
          }
          .header p {
            color: #616161;
            margin: 0;
            font-size: 16px;
            line-height: 1.5;
          }
          .success-badge {
            display: inline-block;
            background: #108043;
            color: white;
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 12px;
            margin-left: 8px;
          }
          .card {
            background: #f9fafb;
            border: 1px solid #e1e3e5;
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 24px;
          }
          .card h2 {
            margin: 0 0 16px 0;
            font-size: 20px;
            font-weight: 500;
            color: #202223;
          }
          .steps {
            counter-reset: step-counter;
            list-style: none;
            padding: 0;
            margin: 0;
          }
          .steps li {
            margin-bottom: 20px;
            padding-left: 48px;
            position: relative;
            counter-increment: step-counter;
            line-height: 1.6;
          }
          .steps li::before {
            content: counter(step-counter);
            position: absolute;
            left: 0;
            top: 2px;
            width: 32px;
            height: 32px;
            background: #f3f4f6;
            color: #202223;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 500;
            font-size: 14px;
          }
          .big-button {
            display: inline-block;
            padding: 12px 24px;
            background: #202223;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            font-size: 15px;
            transition: all 0.2s;
          }
          .big-button:hover {
            background: #000;
            transform: translateY(-1px);
          }
          .footer {
            text-align: center;
            color: #616161;
            font-size: 14px;
            margin-top: 40px;
            line-height: 1.6;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>BGN/EUR Price Display</h1>
            <p>Показвайте цените в лева и евро на Thank You страницата</p>
            <span class="success-badge">✓ Активно</span>
          </div>

          <div class="card">
            <h2>Инструкции за инсталация</h2>
            <ol class="steps">
              <li>
                <strong>Отидете в Theme Customizer</strong><br>
                <span style="color: #616161;">Online Store → Themes → Customize</span>
              </li>
              <li>
                <strong>Навигирайте до Thank You страницата</strong><br>
                <span style="color: #616161;">Settings → Checkout → Thank you page</span>
              </li>
              <li>
                <strong>Добавете приложението</strong><br>
                <span style="color: #616161;">Add block → Apps → BGN EUR Price Display</span>
              </li>
              <li>
                <strong>Запазете промените</strong><br>
                <span style="color: #616161;">Кликнете Save в горния десен ъгъл</span>
              </li>
            </ol>
          </div>

          <div class="card">
            <h2>Бърз старт</h2>
            <p style="margin-bottom: 20px;">Инсталирайте extension-а с едно кликване:</p>
            <a href="https://${shop}/admin/themes/current/editor?context=checkout&template=checkout" 
               class="big-button" 
               target="_blank">
              Отвори Theme Editor
            </a>
          </div>

          <div class="footer">
            <p>BGN/EUR Prices Display v1.0 • Създадено за български онлайн магазини</p>
            <p style="margin-top: 8px;">Нужда от помощ? Свържете се с нас на emarketingbg@gmail.com</p>
          </div>
        </div>
      </body>
    </html>
  `;
});

app.use(router.routes());
app.use(router.allowedMethods());
app.listen(PORT, () => console.log(`> App listening on port ${PORT}`));