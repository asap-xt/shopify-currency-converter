// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import koaSession from 'koa-session';
import Router from 'koa-router';
import { shopifyApi, LATEST_API_VERSION, LogSeverity } from '@shopify/shopify-api';

// --- DEBUG: Environment check ---
console.log('=== Environment Variables Check ===');
console.log('SHOPIFY_API_KEY:', process.env.SHOPIFY_API_KEY ? 'SET' : 'MISSING');
console.log('SHOPIFY_API_SECRET:', process.env.SHOPIFY_API_SECRET ? 'SET' : 'MISSING');
console.log('SCOPES:', process.env.SCOPES);
console.log('HOST:', process.env.HOST);
console.log('====================================');

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SCOPES,
  HOST
} = process.env;

if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SCOPES || !HOST) {
  console.error('FATAL: One or more required environment variables are missing!');
  process.exit(1);
}

// --- КОРЕКЦИЯ: Използваме вградения MemorySessionStorage за простота и съвместимост ---
const sessionStorage = new Shopify.Session.MemorySessionStorage();

// --- КОРЕКЦИЯ: Правилна и пълна инициализация на Shopify API ---
const Shopify = shopifyApi({
  apiKey:         SHOPIFY_API_KEY,
  apiSecretKey:   SHOPIFY_API_SECRET,
  scopes:          SCOPES.split(','),
  hostName:       HOST.replace(/https?:\/\//, ''),
  apiVersion:     LATEST_API_VERSION,
  isEmbeddedApp:  true,
  sessionStorage: sessionStorage, // Подаваме session storage тук
  // Задължително е да дефинирате webhook за изтриване на приложението
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: 'http',
      callbackUrl: '/webhooks',
    },
  },
  // Увеличаваме нивото на логовете за по-добър дебъг
  logger: {
    level: LogSeverity.Debug,
  },
});

console.log('✓ Shopify API initialized successfully');

const app = new Koa();
const router = new Router();

app.keys = [Shopify.config.apiSecretKey];

// Request logging middleware
app.use(async (ctx, next) => {
  console.log(`${new Date().toISOString()} - ${ctx.method} ${ctx.path} - Query:`, ctx.query);
  await next();
});

app.use(koaSession({ sameSite: 'none', secure: true }, app));


// --- КОРЕКЦИЯ: Middleware за обработка на Webhooks ---
router.post('/webhooks', async (ctx) => {
    try {
      const rawBody = await ctx.req.text(); // Koa body parser може да пречи, затова четем ръчно
      await Shopify.Webhooks.Registry.process({
        rawBody: rawBody,
        rawRequest: ctx.req,
        rawResponse: ctx.res,
      });
      console.log(`Webhook processed for topic: ${ctx.get('X-Shopify-Topic')}`);
      ctx.status = 200;
    } catch (error) {
      console.error(`Failed to process webhook: ${error}`);
      ctx.status = 500;
    }
});

// --- КОРЕКЦИЯ: OAuth Middleware-ите се задават преди маршрутите ---
// Те ще обработят /auth и /auth/callback автоматично
app.use(Shopify.auth.begin());
app.use(Shopify.auth.callback({
    callbackPath: '/auth/callback',
    async afterAuth(ctx) {
        const { session } = ctx.state.shopify;
        const host = ctx.query.host;

        await Shopify.Webhooks.Registry.registerAll({ shop: session.shop });
        console.log(`Webhooks registered for shop: ${session.shop}`);

        ctx.redirect(`/?shop=${session.shop}&host=${host}`);
    },
}));

// Всички заявки след този ред трябва да са валидирани
app.use(Shopify.cspHeaders());
app.use(Shopify.ensureInstalled());


// --- ВАШИТЕ СЪЩЕСТВУВАЩИ МАРШРУТИ ОСТАВАТ НЕПРОМЕНЕНИ ---
// (Само ще адаптираме начина на взимане на сесията)

// Helper function to load session for your API routes
async function loadSessionForApi(ctx) {
    const session = await Shopify.Utils.loadCurrentSession(ctx.req, ctx.res, false);
    if (!session) {
        console.log('API call blocked: No valid session found for shop.');
        ctx.status = 401;
        ctx.body = 'Unauthorized';
        return null;
    }
    return session;
}

// Всички ваши дебъг и API маршрути
router.get('/health', (ctx) => { ctx.body = 'OK'; });

router.get('/debug', (ctx) => {
  ctx.body = {
    message: 'Debug route works!',
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      port: process.env.PORT,
      hasShopifyKey: !!SHOPIFY_API_KEY,
      scopes: SCOPES,
      hostName: process.env.HOST_NAME,
      host: HOST
    }
  };
});

router.get('/api/test', async (ctx) => {
    const session = await loadSessionForApi(ctx);
    if (!session) return;
    ctx.body = {
      message: 'Success!',
      session: {
        shop: session.shop,
        scope: session.scope,
        isOnline: session.isOnline,
        hasAccessToken: !!session.accessToken
      }
    };
});

router.get('/api/orders', async (ctx) => {
    const session = await loadSessionForApi(ctx);
    if (!session) return;
    const client = new Shopify.Clients.Rest({ session });
    const response = await client.get({ path: 'orders', query: { limit: 10 } });
    ctx.body = response.body;
});

router.get('/api/themes', async (ctx) => {
    const session = await loadSessionForApi(ctx);
    if (!session) return;
    const client = new Shopify.Clients.Rest({ session });
    const response = await client.get({ path: 'themes' });
    ctx.body = response.body;
});

router.get('/api/shop', async (ctx) => {
    const session = await loadSessionForApi(ctx);
    if (!session) return;
    const client = new Shopify.Clients.Rest({ session });
    const response = await client.get({ path: 'shop' });
    ctx.body = response.body;
});

// Helper function to get main theme ID for the comprehensive test
async function getMainThemeId(session) {
    try {
        const client = new Shopify.Clients.Rest({ session });
        const response = await client.get({ path: 'themes' });
        const mainTheme = response.body.themes?.find(theme => theme.role === 'main');
        return mainTheme?.id;
    } catch (error) {
        console.error("Could not fetch main theme ID:", error);
        return null;
    }
}

router.get('/api/test-all', async (ctx) => {
    const session = await loadSessionForApi(ctx);
    if (!session) return;
    
    const results = {};
    const client = new Shopify.Clients.Rest({ session });
    const mainThemeId = await getMainThemeId(session);

    const apiTests = [
        { name: 'shop', path: 'shop' },
        { name: 'themes', path: 'themes' },
        { name: 'orders_count', path: 'orders/count' },
        { name: 'products_count', path: 'products/count' },
        { name: 'products', path: 'products', query: { limit: 1 } },
        { name: 'orders', path: 'orders', query: { limit: 1 } },
        { name: 'locations', path: 'locations' },
        { name: 'webhooks', path: 'webhooks' },
        { name: 'scriptTags', path: 'script_tags' },
        mainThemeId ? { name: 'assets', path: `themes/${mainThemeId}/assets` } : null,
    ].filter(Boolean);

    for (const test of apiTests) {
        try {
            const response = await client.get({ path: test.path, query: test.query });
            results[test.name] = { status: 200, success: true, hasData: !!response.body };
        } catch (error) {
            results[test.name] = { status: error.response?.code, success: false, error: error.message };
        }
    }
    
    ctx.body = {
        shop: session.shop,
        sessionScope: session.scope,
        message: 'Comprehensive API test results',
        results: results,
        workingAPIs: Object.keys(results).filter(key => results[key].success),
        blockedAPIs: Object.keys(results).filter(key => !results[key].success)
    };
});

router.get('/api/products', async (ctx) => {
    const session = await loadSessionForApi(ctx);
    if (!session) return;
    const client = new Shopify.Clients.Rest({ session });
    const response = await client.get({ path: 'products', query: { limit: 5 } });
    const products = response.body.products;
    const productPricing = products?.map(product => ({
        id: product.id,
        title: product.title,
        vendor: product.vendor,
        variants: product.variants?.map(variant => ({
            id: variant.id,
            title: variant.title,
            price: variant.price,
            compare_at_price: variant.compare_at_price,
            sku: variant.sku
        }))
    })) || [];
    ctx.body = {
        success: true,
        shop: session.shop,
        productsCount: products?.length || 0,
        products: productPricing,
        message: 'Products API works - useful for currency conversion!'
    };
});

router.get('/api/orders-graphql', async (ctx) => {
    const session = await loadSessionForApi(ctx);
    if (!session) return;
    const client = new Shopify.Clients.Graphql({ session });
    const query = `
    {
      orders(first: 10) {
        edges {
          node {
            id
            name
            createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }
    }`;
    const response = await client.query({ data: query });
    ctx.body = response.body;
});

router.get('/api/debug-token', async (ctx) => {
    const session = await loadSessionForApi(ctx);
    if (!session) return;

    const tests = {};
    const client = new Shopify.Clients.Rest({ session });
    
    try {
        await client.get({ path: 'shop' });
        tests.shop = { success: true };
    } catch (err) {
        tests.shop = { success: false, error: err.message };
    }
    
    try {
        await client.get({ path: 'orders/count' });
        tests.ordersCount = { success: true };
    } catch (err) {
        tests.ordersCount = { success: false, error: err.message };
    }

    ctx.body = {
        shop: session.shop,
        sessionScope: session.scope,
        requestedScopes: SCOPES,
        tokenPresent: !!session.accessToken,
        tests: tests
    };
});

router.get('/debug-auth', async (ctx) => {
    ctx.body = {
        message: 'Auth debug info',
        env: {
            hasApiKey: !!process.env.SHOPIFY_API_KEY,
            scopes: process.env.SCOPES,
        },
        sessions: Array.from(sessionStorage.storage.keys())
    };
});

// --- КОРЕКЦИЯ: Опростен главен маршрут ---
router.get('(/)', async (ctx) => {
    const shop = ctx.query.shop;
    console.log(`Rendering app for shop: ${shop}`);
    
    ctx.set('Content-Type', 'text/html');
    ctx.body = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BGN↔EUR Currency Display</title>
  <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      background: #f4f6f8;
      color: #202223;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: white;
      border-radius: 12px;
      padding: 30px;
      text-align: center;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    .header h1 {
      margin: 0 0 10px 0;
      font-size: 28px;
      font-weight: 600;
    }
    .header p {
      color: #616161;
      margin: 0;
      font-size: 16px;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.1);
    }
    .card h2 {
      margin: 0 0 16px 0;
      font-size: 20px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .steps {
      counter-reset: step-counter;
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .steps li {
      margin-bottom: 16px;
      padding-left: 40px;
      position: relative;
      counter-increment: step-counter;
    }
    .steps li::before {
      content: counter(step-counter);
      position: absolute;
      left: 0;
      top: 0;
      width: 28px;
      height: 28px;
      background: #008060;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 14px;
    }
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .feature {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .feature-icon {
      font-size: 24px;
      line-height: 1;
    }
    .feature-text h3 {
      margin: 0 0 4px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .feature-text p {
      margin: 0;
      color: #616161;
      font-size: 14px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: #f3f4f6;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      margin-right: 8px;
    }
    .badge.new {
      background: #e3f5ff;
      color: #004c99;
    }
    .warning {
      background: #fff4e5;
      border: 1px solid #ffea8a;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .warning-icon {
      font-size: 20px;
      line-height: 1;
    }
    .footer {
      text-align: center;
      color: #616161;
      font-size: 14px;
      margin-top: 40px;
    }
    .debug-section {
      background: #f9fafb;
      border: 1px solid #e1e3e5;
      border-radius: 6px;
      padding: 16px;
      margin-top: 20px;
    }
    .debug-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .debug-links a {
      font-size: 12px;
      color: #2c6ecb;
      text-decoration: none;
      padding: 4px 8px;
      background: white;
      border: 1px solid #e1e3e5;
      border-radius: 4px;
    }
    .debug-links a:hover {
      background: #f3f4f6;
    }
  </style>
  <script>
    document.addEventListener('DOMContentLoaded', () => {
        const app = window['app-bridge'].createApp({
            apiKey: '${SHOPIFY_API_KEY}',
            host: new URL(location.href).searchParams.get("host"),
        });
    });
  </script>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🇧🇬 BGN↔EUR Currency Display 🇪🇺</h1>
      <p>Показвайте цените едновременно в лева и евро на Thank You страницата</p>
    </div>
    <div class="card">
      <h2>📋 Инструкции за инсталация</h2>
      <ol class="steps">
        <li><strong>Отидете в Theme Customizer</strong><br><span style="color: #616161;">Online Store → Themes → Customize</span></li>
        <li><strong>Навигирайте до Thank You страницата</strong><br><span style="color: #616161;">Settings → Checkout → Thank you page</span></li>
        <li><strong>Добавете приложението</strong><br><span style="color: #616161;">Add block → Apps → BGN↔EUR Currency Display</span></li>
        <li><strong>Запазете промените</strong><br><span style="color: #616161;">Кликнете Save в горния десен ъгъл</span></li>
      </ol>
    </div>
    <div class="card">
      <h2>🎯 Как работи</h2>
      <div class="feature-grid">
        <div class="feature"><div class="feature-icon">💰</div><div class="feature-text"><h3>Двойно показване</h3><p>Всички цени се показват едновременно в BGN и EUR</p></div></div>
        <div class="feature"><div class="feature-icon">🔢</div><div class="feature-text"><h3>Фиксиран курс</h3><p>1 EUR = 1.95583 BGN според БНБ</p></div></div>
        <div class="feature"><div class="feature-icon">📦</div><div class="feature-text"><h3>Пълна разбивка</h3><p>Продукти, доставка и обща сума</p></div></div>
      </div>
      <div class="warning"><div class="warning-icon">⚠️</div><div><strong>Важно:</strong> Приложението работи само за поръчки в български лева (BGN) с адрес на доставка в България.</div></div>
    </div>
    <div class="card">
      <h2>🚀 Предстоящи функции</h2>
      <div style="margin-bottom: 16px;"><span class="badge new">СКОРО</span><strong>Order Status Page</strong><p style="margin: 8px 0 0 0; color: #616161;">Разширяваме функционалността и към страницата за статус на поръчката.</p></div>
      <div><span class="badge">2026</span><strong>Автоматично преминаване към EUR</strong><p style="margin: 8px 0 0 0; color: #616161;">След 01.01.2026 г. приложението автоматично ще превключи да показва EUR като основна валута.</p></div>
    </div>
    <div class="debug-section">
      <h2>🚀 Дебъг информация</h2>
      <p>Използвайте тези линкове, за да тествате API достъпа след инсталация.</p>
      <div class="debug-links">
        <a href="/api/test?shop=${shop}" target="_blank">Test Session</a>
        <a href="/api/shop?shop=${shop}" target="_blank">Shop Info</a>
        <a href="/api/orders?shop=${shop}" target="_blank">Recent Orders</a>
        <a href="/api/debug-token?shop=${shop}" target="_blank">Debug Token</a>
        <a href="/api/test-all?shop=${shop}" target="_blank">Comprehensive API Test</a>
      </div>
    </div>
    <div class="footer"><p>BGN↔EUR Currency Display v1.0 • Създадено за български онлайн магазини</p></div>
  </div>
</body>
</html>
`;
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => { // Bind to 0.0.0.0 for Railway
  console.log(`✓ Server listening on port ${PORT}`);
  console.log(`✓ App URL: ${HOST}`);
  console.log(`✓ Auth URL: ${HOST}/auth`);
});
