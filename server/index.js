// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import koaSession from 'koa-session';
import Router from 'koa-router';
import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';

// Environment check
console.log('=== Environment Variables Check ===');
console.log('SHOPIFY_API_KEY:', process.env.SHOPIFY_API_KEY ? 'SET' : 'MISSING');
console.log('SHOPIFY_API_SECRET:', process.env.SHOPIFY_API_SECRET ? 'SET' : 'MISSING');
console.log('SCOPES:', process.env.SCOPES);
console.log('HOST:', process.env.HOST);
console.log('====================================');

// Session storage
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

// Validation
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SCOPES || !HOST_NAME) {
  console.error('FATAL: Missing required environment variables!');
  process.exit(1);
}

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: SHOPIFY_API_KEY,
  apiSecretKey: SHOPIFY_API_SECRET,
  scopes: SCOPES.split(','),
  hostName: HOST_NAME,
  apiVersion: '2024-10',
  isEmbeddedApp: true,
  sessionStorage: memorySessionStorage,
});

const app = new Koa();
app.keys = [SHOPIFY_API_SECRET];

// Request logging
app.use(async (ctx, next) => {
  console.log(`${new Date().toISOString()} - ${ctx.method} ${ctx.path}`);
  try {
    await next();
  } catch (err) {
    console.error(`Error handling ${ctx.method} ${ctx.path}:`, err);
    throw err;
  }
});

app.use(koaSession({ sameSite: 'none', secure: true }, app));

const router = new Router();

// Health check
router.get('/health', async (ctx) => {
  ctx.body = 'OK';
});

// Helper functions за Token Exchange подхода
function getSessionTokenHeader(ctx) {
  return ctx.headers['authorization']?.replace('Bearer ', '');
}

function getSessionTokenFromUrlParam(ctx) {
  return ctx.query.id_token;
}

function redirectToSessionTokenBouncePage(ctx) {
  const searchParams = new URLSearchParams(ctx.query);
  // Премахваме id_token защото може да е стар
  searchParams.delete('id_token');
  
  // Използваме shopify-reload за автоматичен redirect
  searchParams.append('shopify-reload', `${ctx.path}?${searchParams.toString()}`);
  ctx.redirect(`/session-token-bounce?${searchParams.toString()}`);
}

// Session token bounce page - минимална HTML страница само с App Bridge
router.get('/session-token-bounce', async (ctx) => {
  ctx.set('Content-Type', 'text/html');
  ctx.body = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="shopify-api-key" content="${SHOPIFY_API_KEY}" />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
      </head>
      <body>Loading...</body>
    </html>
  `;
});

// Middleware за автентикация чрез Token Exchange
async function authenticateRequest(ctx, next) {
  console.log('=== AUTHENTICATING REQUEST ===');
  
  let encodedSessionToken = null;
  let decodedSessionToken = null;
  
  try {
    // Вземаме session token от header или URL
    encodedSessionToken = getSessionTokenHeader(ctx) || getSessionTokenFromUrlParam(ctx);
    
    if (!encodedSessionToken) {
      console.log('No session token found');
      const isDocumentRequest = !ctx.headers['authorization'];
      if (isDocumentRequest) {
        redirectToSessionTokenBouncePage(ctx);
        return;
      }
      
      ctx.status = 401;
      ctx.set('X-Shopify-Retry-Invalid-Session-Request', '1');
      ctx.body = 'Unauthorized';
      return;
    }
    
    // Декодираме и валидираме session token
    decodedSessionToken = await shopify.session.decodeSessionToken(encodedSessionToken);
    console.log('Session token decoded:', { dest: decodedSessionToken.dest, iss: decodedSessionToken.iss });
    
  } catch (e) {
    console.error('Invalid session token:', e.message);
    
    const isDocumentRequest = !ctx.headers['authorization'];
    if (isDocumentRequest) {
      redirectToSessionTokenBouncePage(ctx);
      return;
    }
    
    ctx.status = 401;
    ctx.set('X-Shopify-Retry-Invalid-Session-Request', '1');
    ctx.body = 'Unauthorized';
    return;
  }
  
  // Извличаме shop от decoded token
  const dest = new URL(decodedSessionToken.dest);
  const shop = dest.hostname;
  
  // Проверяваме дали имаме валидна сесия със access token
  const sessions = await memorySessionStorage.findSessionsByShop(shop);
  let session = sessions.find(s => !s.isOnline);
  
  if (!session || !session.accessToken || session.accessToken === 'placeholder') {
    console.log('No valid session with access token, performing token exchange...');
    
    try {
      // Token Exchange - това е новият начин!
      const tokenExchangeResult = await shopify.auth.tokenExchange({
        sessionToken: encodedSessionToken,
        requestedTokenType: 'offline_access_token',
      });
      
      console.log('Token exchange successful');
      
      // Създаваме/обновяваме сесията с новия access token
      const sessionId = `${shop}_offline`;
      session = new Session({
        id: sessionId,
        shop: shop,
        state: 'active',
        isOnline: false,
        accessToken: tokenExchangeResult.accessToken,
        scope: tokenExchangeResult.scope,
      });
      
      await memorySessionStorage.storeSession(session);
      
    } catch (error) {
      console.error('Token exchange failed:', error);
      ctx.status = 500;
      ctx.body = 'Token exchange failed';
      return;
    }
  }
  
  // Добавяме shop и session към context
  ctx.state.shop = shop;
  ctx.state.session = session;
  
  await next();
}

// API endpoints - всички използват authenticateRequest middleware
router.get('/api/test', authenticateRequest, async (ctx) => {
  console.log('=== API TEST ===');
  ctx.body = { 
    message: 'Success! Session is valid', 
    shop: ctx.state.shop,
    hasAccessToken: !!ctx.state.session.accessToken,
    scope: ctx.state.session.scope
  };
});

router.get('/api/shop', authenticateRequest, async (ctx) => {
  console.log('=== SHOP INFO API ===');
  
  try {
    const response = await fetch(`https://${ctx.state.shop}/admin/api/2024-10/shop.json`, {
      headers: { 
        'X-Shopify-Access-Token': ctx.state.session.accessToken,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }
    
    const shopData = await response.json();
    ctx.body = {
      success: true,
      shop: shopData.shop
    };
    
  } catch (error) {
    console.error('Error fetching shop info:', error);
    ctx.status = 500;
    ctx.body = 'Failed to fetch shop info: ' + error.message;
  }
});

router.get('/api/orders', authenticateRequest, async (ctx) => {
  console.log('=== ORDERS API TEST ===');
  
  try {
    const response = await fetch(`https://${ctx.state.shop}/admin/api/2024-10/orders.json?limit=10`, {
      headers: { 
        'X-Shopify-Access-Token': ctx.state.session.accessToken,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }
    
    const orders = await response.json();
    ctx.body = {
      success: true,
      shop: ctx.state.shop,
      ordersCount: orders.orders?.length || 0,
      orders: orders.orders || []
    };
    
  } catch (error) {
    console.error('Error fetching orders:', error);
    ctx.status = 500;
    ctx.body = 'Failed to fetch orders: ' + error.message;
  }
});

// Main app route - НЕ изисква предварителна автентикация
router.get('(/)', async (ctx) => {
  console.log('=== MAIN ROUTE ===');
  const shop = ctx.query.shop;
  const host = ctx.query.host;
  
  if (!shop) {
    ctx.body = "Missing shop parameter. Please install the app through Shopify.";
    ctx.status = 400;
    return;
  }
  
  // При Shopify managed install, приложението се инсталира автоматично
  // и ние получаваме session token в URL или ще го получим през App Bridge
  
  ctx.set('Content-Type', 'text/html');
  // Заменете съществуващия HTML в main route (около ред 290) с този:

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
      cursor: pointer;
    }
    .debug-links a:hover {
      background: #f3f4f6;
    }
    .loading {
      text-align: center;
      padding: 40px;
      color: #666;
      display: none;
    }
    .success-badge {
      display: inline-block;
      background: #008060;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      margin-left: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🇧🇬 BGN/EUR Price Display 🇪🇺</h1>
      <p>Показвайте цените в лева и евро на Thank You страницата</p>
      <div class="loading" id="loading">Зареждане...</div>
      <span id="status-badge" style="display: none;" class="success-badge">✓ Активно</span>
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
          <span style="color: #616161;">Add block → Apps → BGN EUR Price Display</span>
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
            <p>1 EUR = 1.95583 BGN</p>
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
          <strong>Важно:</strong>  В настройките на магазина трябва да имате България като отделен пазар. Цените в BGN/EUR се показват само за поръчки в български лева (BGN) с адрес на доставка в България.
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
        <span class="badge">ПЛАНИРАНО</span>
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
        <li>Проверете дали extension-а е активен в Theme Customizer</li>
      </ul>
    </div>

    <!--
    <div class="debug-section">
      <strong>🔧 Debug Tools</strong>
      <div class="debug-links">
        <a onclick="testAPI('/api/test?shop=${shop}')">Test Session</a>
        <a onclick="testAPI('/api/shop?shop=${shop}')">Shop Info</a>
        <a onclick="testAPI('/api/orders?shop=${shop}')">Orders API</a>
        <a href="/debug" target="_blank">Debug Info</a>
        <a href="/health" target="_blank">Health Check</a>
      </div>
      <div id="debug-output" style="margin-top: 12px; display: none;">
        <pre style="background: white; padding: 12px; border-radius: 4px; font-size: 12px; overflow-x: auto;"></pre>
      </div>
    </div>
    -->

    <div class="footer">
      <p>BGN/EUR Prices Display v1.0 • Създадено за български онлайн магазини</p>
      <p style="margin-top: 8px;">Нужда от помощ? Свържете се с нас на emarketingbg@gmail.com</p>
    </div>
  </div>
  
  <script>
    // App Bridge автоматично добавя session token към всички fetch requests
    async function loadAppData() {
      try {
        const response = await fetch('/api/shop?shop=${shop}');
        if (response.ok) {
          const data = await response.json();
          console.log('Shop data loaded:', data);
          document.getElementById('loading').style.display = 'none';
          document.getElementById('status-badge').style.display = 'inline-block';
        } else {
          console.error('Failed to load shop data');
          document.getElementById('loading').innerHTML = 'Грешка при зареждане';
        }
      } catch (error) {
        console.error('Error loading app data:', error);
        document.getElementById('loading').innerHTML = 'Грешка при зареждане';
      }
    }
    
    // Debug функция за тестване на API endpoints
    async function testAPI(endpoint) {
      const outputEl = document.getElementById('debug-output');
      const preEl = outputEl.querySelector('pre');
      
      outputEl.style.display = 'block';
      preEl.textContent = 'Loading...';
      
      try {
        const response = await fetch(endpoint);
        const data = await response.json();
        preEl.textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        preEl.textContent = 'Error: ' + error.message;
      }
    }
    
    // Изчакваме App Bridge да се инициализира
    setTimeout(loadAppData, 1000);
  </script>
</body>
</html>
  `;
});

// Debug route
router.get('/debug', async (ctx) => {
  const allSessions = [];
  for (const [id, session] of memorySessionStorage.storage) {
    allSessions.push({
      id: id,
      shop: session.shop,
      isOnline: session.isOnline,
      hasToken: !!session.accessToken && session.accessToken !== 'placeholder'
    });
  }
  
  ctx.body = {
    message: 'Debug info',
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      hasShopifyKey: !!SHOPIFY_API_KEY,
      scopes: SCOPES,
      host: HOST
    },
    sessions: allSessions
  };
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', function() {
  console.log(`✓ Server listening on port ${PORT}`);
  console.log(`✓ Using Token Exchange authentication (Shopify managed install)`);
  console.log(`✓ App URL: ${HOST}`);
}).on('error', (err) => {
  console.error('FATAL: Server failed to start:', err);
  process.exit(1);
});