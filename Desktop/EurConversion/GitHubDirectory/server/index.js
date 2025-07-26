// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import koaSession from 'koa-session';
import Router from 'koa-router';
import getRawBody from 'raw-body';
import { shopifyApi, LATEST_API_VERSION, BillingInterval, Session } from '@shopify/shopify-api';

// --- DEBUG: Environment check ---
console.log('=== Environment Variables Check ===');
console.log('SHOPIFY_API_KEY:', process.env.SHOPIFY_API_KEY ? 'SET' : 'MISSING');
console.log('SHOPIFY_API_SECRET:', process.env.SHOPIFY_API_SECRET ? 'SET' : 'MISSING');
console.log('SCOPES:', process.env.SCOPES);
console.log('HOST:', process.env.HOST);
console.log('HOST_NAME:', process.env.HOST_NAME);
console.log('PORT:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('====================================');

// --- Собствен session storage ---
const memorySessionStorage = {
  storage: new Map(),
  
  async storeSession(session) {
    this.storage.set(session.id, session);
    return true;
  },

  async loadSession(id) {
    return this.storage.get(id);
  },

  async deleteSession(id) {
    this.storage.delete(id);
    return true;
  },

  async deleteSessions(ids) {
    ids.forEach(id => this.storage.delete(id));
    return true;
  },

  async findSessionsByShop(shop) {
    const sessions = [];
    for (const [id, session] of this.storage) {
      if (session.shop === shop) {
        sessions.push(session);
      }
    }
    return sessions;
  }
};

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SCOPES,
  HOST,
  HOST_NAME
} = process.env;

// Validation на environment variables
if (!SHOPIFY_API_KEY) {
  console.error('FATAL: SHOPIFY_API_KEY is missing!');
  process.exit(1);
}
if (!SHOPIFY_API_SECRET) {
  console.error('FATAL: SHOPIFY_API_SECRET is missing!');
  process.exit(1);
}
if (!SCOPES) {
  console.error('FATAL: SCOPES is missing!');
  process.exit(1);
}
if (!HOST_NAME) {
  console.error('FATAL: HOST_NAME is missing!');
  process.exit(1);
}

console.log('✓ All required environment variables are present');

// ПРАВИЛНА инициализация на Shopify API клиента
let shopify;
try {
  console.log('Initializing Shopify API...');
  shopify = shopifyApi({
    apiKey: SHOPIFY_API_KEY,
    apiSecretKey: SHOPIFY_API_SECRET,
    scopes: SCOPES.split(','),
    hostName: HOST_NAME,
    apiVersion: LATEST_API_VERSION,
    isEmbeddedApp: true,
    sessionStorage: memorySessionStorage,
  });
  console.log('✓ Shopify API initialized successfully');
} catch (error) {
  console.error('FATAL: Failed to initialize Shopify API:', error);
  process.exit(1);
}

const app = new Koa();
app.keys = [SHOPIFY_API_SECRET];

// Global error handler
app.on('error', (err, ctx) => {
  console.error('App error:', err);
});

// Request logging middleware
app.use(async (ctx, next) => {
  console.log(`${new Date().toISOString()} - ${ctx.method} ${ctx.path} - Query:`, ctx.query);
  try {
    await next();
  } catch (err) {
    console.error(`Error handling ${ctx.method} ${ctx.path}:`, err);
    throw err;
  }
});

// Настройки за koa-session за работа с iFrames в Shopify
app.use(koaSession({ sameSite: 'none', secure: true }, app));

const router = new Router();

// Health check route (за Railway)
router.get('/health', async (ctx) => {
  console.log('Health check accessed');
  ctx.body = 'OK';
});

// Debug route
router.get('/debug', async (ctx) => {
  ctx.body = {
    message: 'Debug route works!',
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      port: process.env.PORT,
      hasShopifyKey: !!SHOPIFY_API_KEY,
      scopes: SCOPES,
      hostName: HOST_NAME,
      host: HOST
    }
  };
});

// OAuth start - използваме новия shopify обект
router.get('/auth', async (ctx) => {
  console.log('=== AUTH START ===');
  const shop = ctx.query.shop;
  console.log('Shop parameter:', shop);
  
  if (!shop) {
    console.log('Missing shop parameter');
    ctx.throw(400, 'Missing shop parameter');
    return;
  }
  
  try {
    console.log('Starting OAuth flow...');
    
    // За embedded apps, трябва да използваме правилния начин
    const redirectUrl = await shopify.auth.begin({
      shop,
      callbackPath: '/auth/callback',
      isOnline: false, // offline tokens за постоянен достъп
      rawRequest: ctx.req,
      rawResponse: ctx.res,
    });
    
    console.log('Redirecting to:', redirectUrl);
    ctx.redirect(redirectUrl);
    
  } catch (error) {
    console.error('Error starting OAuth:', error);
    ctx.status = 500;
    ctx.body = 'Auth initialization failed: ' + error.message;
  }
});

// OAuth callback - САМО ЕДИН, не два!
router.get('/auth/callback', async (ctx) => {
  console.log('=== AUTH CALLBACK ===');
  console.log('Callback query:', ctx.query);
  
  try {
    const callbackResponse = await shopify.auth.callback({
      rawRequest: ctx.req,
      rawResponse: ctx.res,
    });
    
    console.log('OAuth callback successful:', {
      shop: callbackResponse.session.shop,
      isOnline: callbackResponse.session.isOnline,
      scope: callbackResponse.session.scope
    });
    
    // Shopify SDK автоматично записва сесията чрез нашия sessionStorage
    
    // За embedded apps, трябва специално пренасочване
    const host = ctx.query.host;
    const shop = callbackResponse.session.shop;
    
    // Използваме Shopify App Bridge redirect за embedded apps
    ctx.body = `
      <!DOCTYPE html>
      <html>
        <head>
          <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
          <script>
            var AppBridge = window['app-bridge'];
            var createApp = AppBridge.default;
            var Redirect = AppBridge.actions.Redirect;
            
            const app = createApp({
              apiKey: '${SHOPIFY_API_KEY}',
              host: '${host}',
            });
            
            const redirect = Redirect.create(app);
            redirect.dispatch(Redirect.Action.APP, '/?shop=${shop}&host=${host}');
          </script>
        </head>
      </html>
    `;
    
  } catch (error) {
    console.error("Auth callback failed:", error);
    ctx.status = 500;
    ctx.body = 'Authentication failed: ' + error.message;
  }
});

// Защитен ендпойнт за проверка на сесията
router.get('/api/test', async (ctx) => {
  console.log('=== API TEST ===');
  try {
    const shop = ctx.query.shop;
    if (!shop) {
      ctx.status = 400;
      ctx.body = 'Missing shop parameter';
      return;
    }
    
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    const session = sessions.find(s => !s.isOnline); // търсим offline session
    
    if (session && session.accessToken) {
      console.log('Session found:', session.shop);
      ctx.body = { 
        message: 'Success!', 
        session: { 
          shop: session.shop, 
          scope: session.scope,
          isOnline: session.isOnline,
          hasAccessToken: !!session.accessToken
        } 
      };
    } else {
      console.log('No session found for shop:', shop);
      ctx.status = 401;
      ctx.body = 'Unauthorized - No valid session';
    }
  } catch (error) {
    console.error('Error in API test:', error);
    ctx.status = 500;
    ctx.body = 'Internal error: ' + error.message;
  }
});

// Тестване на Orders API
router.get('/api/orders', async (ctx) => {
  console.log('=== ORDERS API TEST ===');
  try {
    const shop = ctx.query.shop;
    if (!shop) {
      ctx.status = 400;
      ctx.body = 'Missing shop parameter';
      return;
    }
    
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    const session = sessions.find(s => !s.isOnline);
    
    if (!session || !session.accessToken) {
      ctx.status = 401;
      ctx.body = 'Unauthorized - No valid session';
      return;
    }
    
    console.log('Fetching orders for shop:', shop);
    const response = await fetch(`https://${shop}/admin/api/2024-01/orders.json?limit=10`, {
      headers: { 
        'X-Shopify-Access-Token': session.accessToken,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
    }
    
    const orders = await response.json();
    console.log(`Found ${orders.orders?.length || 0} orders`);
    
    ctx.body = {
      success: true,
      shop: shop,
      ordersCount: orders.orders?.length || 0,
      orders: orders.orders || []
    };
    
  } catch (error) {
    console.error('Error fetching orders:', error);
    ctx.status = 500;
    ctx.body = 'Failed to fetch orders: ' + error.message;
  }
});

// Shop info API
router.get('/api/shop', async (ctx) => {
  console.log('=== SHOP INFO API TEST ===');
  try {
    const shop = ctx.query.shop;
    if (!shop) {
      ctx.status = 400;
      ctx.body = 'Missing shop parameter';
      return;
    }
    
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    const session = sessions.find(s => !s.isOnline);
    
    if (!session || !session.accessToken) {
      ctx.status = 401;
      ctx.body = 'Unauthorized - No valid session';
      return;
    }
    
    console.log('Fetching shop info for:', shop);
    const response = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: { 
        'X-Shopify-Access-Token': session.accessToken,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
    }
    
    const shopData = await response.json();
    console.log('Shop info retrieved successfully');
    
    ctx.body = {
      success: true,
      shop: {
        name: shopData.shop.name,
        domain: shopData.shop.domain,
        currency: shopData.shop.currency,
        country: shopData.shop.country,
        timezone: shopData.shop.timezone,
        plan_name: shopData.shop.plan_name
      }
    };
    
  } catch (error) {
    console.error('Error fetching shop info:', error);
    ctx.status = 500;
    ctx.body = 'Failed to fetch shop info: ' + error.message;
  }
});

// Debug auth route
router.get('/debug-auth', async (ctx) => {
  const allSessions = [];
  for (const [id, session] of memorySessionStorage.storage) {
    allSessions.push({
      id: id,
      shop: session.shop,
      isOnline: session.isOnline,
      hasToken: !!session.accessToken
    });
  }
  
  ctx.body = {
    message: 'Auth debug info',
    env: {
      hasApiKey: !!process.env.SHOPIFY_API_KEY,
      hasSecret: !!process.env.SHOPIFY_API_SECRET,
      scopes: process.env.SCOPES,
      host: process.env.HOST,
      hostName: process.env.HOST_NAME
    },
    sessions: allSessions
  };
});

// Main route - трябва да е последен в router дефинициите
router.get('(/)', async (ctx) => {
  console.log('=== MAIN ROUTE ===');
  const shop = ctx.query.shop;
  const host = ctx.query.host;
  console.log('Shop parameter:', shop);
  console.log('Host parameter:', host);

  try {
    if (!shop) {
      console.log('No shop parameter');
      ctx.body = "Missing shop parameter. Please install the app through Shopify.";
      ctx.status = 400;
      return;
    }

    // Проверка дали имаме активна сесия
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    const session = sessions.find(s => !s.isOnline);
    console.log('Session check for shop:', shop, session ? 'FOUND' : 'NOT FOUND');

    if (!session || !session.accessToken) {
      // Ако няма сесия, пращаме към auth
      console.log('No valid session, redirecting to auth');
      ctx.redirect(`/auth?shop=${shop}&host=${host}`);
      return;
    }
    
    console.log('Session found, showing app interface');
    // Ако има сесия, показваме HTML
    ctx.set('Content-Type', 'text/html');
    ctx.body = `
<!DOCTYPE html>
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
    .button {
      display: inline-block;
      padding: 10px 20px;
      background: #008060;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      margin-top: 16px;
      transition: background 0.2s;
    }
    .button:hover {
      background: #006e52;
    }
    .footer {
      text-align: center;
      color: #616161;
      font-size: 14px;
      margin-top: 40px;
    }
    code {
      background: #f3f4f6;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 14px;
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
    const app = AppBridge.createApp({
      apiKey: '${SHOPIFY_API_KEY}',
      host: '${host}',
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
          <span style="color: #616161;">Add block → Apps → BGN↔EUR Currency Display</span>
        </li>
        <li>
          <strong>Запазете промените</strong><br>
          <span style="color: #616161;">Кликнете Save в горния десен ъгъл</span>
        </li>
      </ol>
    </div>

    <div class="card">
      <h2>🎯 Как работи</h2>
      <div class="feature-grid">
        <div class="feature">
          <div class="feature-icon">💰</div>
          <div class="feature-text">
            <h3>Двойно показване</h3>
            <p>Всички цени се показват едновременно в BGN и EUR</p>
          </div>
        </div>
        <div class="feature">
          <div class="feature-icon">🔢</div>
          <div class="feature-text">
            <h3>Фиксиран курс</h3>
            <p>1 EUR = 1.95583 BGN според БНБ</p>
          </div>
        </div>
        <div class="feature">
          <div class="feature-icon">📦</div>
          <div class="feature-text">
            <h3>Пълна разбивка</h3>
            <p>Продукти, доставка и обща сума</p>
          </div>
        </div>
      </div>
      
      <div class="warning">
        <div class="warning-icon">⚠️</div>
        <div>
          <strong>Важно:</strong> Приложението работи само за поръчки в български лева (BGN) с адрес на доставка в България.
        </div>
      </div>
    </div>

    <div class="card">
      <h2>🚀 Предстоящи функции</h2>
      <div style="margin-bottom: 16px;">
        <span class="badge new">СКОРО</span>
        <strong>Order Status Page</strong>
        <p style="margin: 8px 0 0 0; color: #616161;">
          Разширяваме функционалността и към страницата за статус на поръчката, където клиентите ще виждат същата информация за валутите.
        </p>
      </div>
      
      <div>
        <span class="badge">СКОРО</span>
        <strong>Автоматично преминаване към EUR</strong>
        <p style="margin: 8px 0 0 0; color: #616161;">
          След 01.01.2026 г. приложението автоматично ще превключи да показва EUR като основна валута и BGN като референтна, в съответствие с приемането на еврото в България.
        </p>
      </div>
    </div>

    <div class="card">
      <h2>💡 Полезни съвети</h2>
      <ul style="margin: 0; padding-left: 20px;">
        <li>Уверете се, че валутата на магазина е настроена на BGN</li>
        <li>Тествайте с реална поръчка за да видите как изглежда</li>
        <li>При проблеми, опитайте да деинсталирате и инсталирате отново</li>
      </ul>
    </div>

    <div class="debug-section">
      <strong>🔧 Debug Tools</strong>
      <div class="debug-links">
        <a href="/api/test?shop=${shop}" target="_blank">Test Session</a>
        <a href="/api/shop?shop=${shop}" target="_blank">Shop Info</a>
        <a href="/api/orders?shop=${shop}" target="_blank">Orders API</a>
        <a href="/debug" target="_blank">Debug Info</a>
        <a href="/health" target="_blank">Health Check</a>
        <a href="/debug-auth" target="_blank">Session Debug</a>
      </div>
    </div>

    <div class="footer">
      <p>BGN↔EUR Currency Display v1.0 • Създадено за български онлайн магазини</p>
      <p style="margin-top: 8px;">Нужда от помощ? Свържете се с нас на support@example.com</p>
    </div>
  </div>
</body>
</html>
    `;
  } catch (error) {
    console.error('Error in main route:', error);
    ctx.status = 500;
    ctx.body = 'Internal error: ' + error.message;
  }
});

// Прилагаме routes
app.use(router.routes());
app.use(router.allowedMethods());

// Използваме Railway's динамичен port
const PORT = process.env.PORT || 3000;

console.log(`Starting server on port ${PORT}...`);

// Bind към 0.0.0.0 за Railway compatibility - ТОВА ТРЯБВА ДА Е ПОСЛЕДНО!
app.listen(PORT, '0.0.0.0', function() {
  console.log(`✓ Server listening on port ${PORT} (bound to 0.0.0.0)`);
  console.log(`✓ App URL: ${HOST}`);
  console.log(`✓ Auth URL: ${HOST}/auth`);
  console.log(`✓ Debug URL: ${HOST}/debug`);
  console.log(`✓ Health URL: ${HOST}/health`);
}).on('error', (err) => {
  console.error('FATAL: Server failed to start:', err);
  process.exit(1);
});