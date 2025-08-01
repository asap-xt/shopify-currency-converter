// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import koaSession from 'koa-session';
import Router from 'koa-router';
import crypto from 'crypto';
import getRawBody from 'raw-body';
import { shopifyApi, LATEST_API_VERSION, Session, GraphqlClient } from '@shopify/shopify-api';

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

// Raw body middleware за webhooks - ВАЖНО: Трябва да е ПРЕДИ другите middleware
app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/webhooks/')) {
    ctx.request.rawBody = await getRawBody(ctx.req, {
      length: ctx.request.headers['content-length'],
      encoding: 'utf8'
    });
  }
  await next();
});

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

// Mandatory compliance webhooks
router.post('/webhooks/customers/data_request', async (ctx) => {
  try {
    const hmacHeader = ctx.get('X-Shopify-Hmac-Sha256');
    const body = ctx.request.rawBody;
    
    if (!hmacHeader || !body) {
      console.log('Missing HMAC header or body');
      ctx.status = 401;
      ctx.body = 'Unauthorized';
      return;
    }
    
    // Verify HMAC
    const hash = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(body, 'utf8')
      .digest('base64');
      
    if (hash !== hmacHeader) {
      console.log('HMAC validation failed');
      ctx.status = 401;
      ctx.body = 'Unauthorized';
      return;
    }
    
    console.log('Customer data request received');
    ctx.status = 200;
    ctx.body = { message: 'No customer data stored' };
  } catch (error) {
    console.error('Webhook error:', error);
    ctx.status = 401;
    ctx.body = 'Unauthorized';
  }
});

router.post('/webhooks/customers/redact', async (ctx) => {
  try {
    const hmacHeader = ctx.get('X-Shopify-Hmac-Sha256');
    const body = ctx.request.rawBody;
    
    if (!hmacHeader || !body) {
      ctx.status = 401;
      ctx.body = 'Unauthorized';
      return;
    }
    
    const hash = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(body, 'utf8')
      .digest('base64');
      
    if (hash !== hmacHeader) {
      ctx.status = 401;
      ctx.body = 'Unauthorized';
      return;
    }
    
    console.log('Customer redact request received');
    ctx.status = 200;
    ctx.body = { message: 'No customer data to redact' };
  } catch (error) {
    console.error('Webhook error:', error);
    ctx.status = 401;
    ctx.body = 'Unauthorized';
  }
});

router.post('/webhooks/shop/redact', async (ctx) => {
  try {
    const hmacHeader = ctx.get('X-Shopify-Hmac-Sha256');
    const body = ctx.request.rawBody;
    
    if (!hmacHeader || !body) {
      ctx.status = 401;
      ctx.body = 'Unauthorized';
      return;
    }
    
    const hash = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(body, 'utf8')
      .digest('base64');
      
    if (hash !== hmacHeader) {
      ctx.status = 401;
      ctx.body = 'Unauthorized';
      return;
    }
    
    console.log('Shop redact request received');
    ctx.status = 200;
    ctx.body = { message: 'No shop data to redact' };
  } catch (error) {
    console.error('Webhook error:', error);
    ctx.status = 401;
    ctx.body = 'Unauthorized';
  }
});

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
  searchParams.delete('id_token');
  searchParams.append('shopify-reload', `${ctx.path}?${searchParams.toString()}`);
  ctx.redirect(`/session-token-bounce?${searchParams.toString()}`);
}

// Session token bounce page
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

// OAuth callback route за Managed Install
router.get('/auth/callback', async (ctx) => {
  console.log('=== AUTH CALLBACK ===');
  
  try {
    const { shop, host, charge_id } = ctx.query;
    
    if (!shop) {
      ctx.status = 400;
      ctx.body = 'Missing shop parameter';
      return;
    }
    
    // Ако идваме от billing callback
    if (charge_id) {
      console.log('Coming from billing, charge_id:', charge_id);
      ctx.redirect(`/?shop=${shop}&host=${host || ''}&billing=success`);
      return;
    }
    
    // При нова инсталация, винаги проверяваме за план
    ctx.redirect(`/?shop=${shop}&host=${host || ''}&check_billing=true`);
    
  } catch (error) {
    console.error('Auth callback error:', error);
    ctx.status = 500;
    ctx.body = 'Authentication failed';
  }
});

// Middleware за автентикация чрез Token Exchange
async function authenticateRequest(ctx, next) {
  console.log('=== AUTHENTICATING REQUEST ===');
  
  let encodedSessionToken = null;
  let decodedSessionToken = null;
  
  try {
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
  
  const dest = new URL(decodedSessionToken.dest);
  const shop = dest.hostname;
  
  const sessions = await memorySessionStorage.findSessionsByShop(shop);
  let session = sessions.find(s => !s.isOnline);
  
  if (!session || !session.accessToken || session.accessToken === 'placeholder') {
    console.log('No valid session with access token, performing token exchange...');
    
    try {
      const tokenExchangeResult = await shopify.auth.tokenExchange({
        shop: shop,
        sessionToken: encodedSessionToken,
        requestedTokenType: 'urn:ietf:params:oauth:token-type:offline-access-token',
      });
      
      console.log('Token exchange successful');
      console.log('Access token received:', tokenExchangeResult.accessToken ? 'Yes' : 'No');
      console.log('Scope:', tokenExchangeResult.scope);
      
      const sessionId = `offline_${shop}`;
      session = {
        id: sessionId,
        shop: shop,
        state: 'active',
        isOnline: false,
        accessToken: tokenExchangeResult.accessToken,
        scope: tokenExchangeResult.scope,
        expires: null,
        onlineAccessInfo: null
      };
      
      // Проверяваме дали наистина има token
      if (!session.accessToken) {
        console.error('WARNING: No access token in token exchange result!');
        console.error('Token exchange result:', tokenExchangeResult);
      }

// Billing check middleware - SIMPLIFIED FOR MANAGED PRICING
async function requiresSubscription(ctx, next) {
  try {
    // Използваме shopify instance вместо да импортираме GraphqlClient
    const client = new shopify.clients.Graphql({
      session: ctx.state.session,
    });
    
    const response = await client.query({
      data: `{
        currentAppInstallation {
          activeSubscriptions {
            id
            status
            name
          }
        }
      }`
    });
    
    const subscriptions = response.body.data.currentAppInstallation.activeSubscriptions || [];
    const hasActiveSubscription = subscriptions.some(sub => 
      sub.status === 'ACTIVE' || sub.status === 'PENDING'
    );
    
    ctx.state.hasActiveSubscription = hasActiveSubscription;
    
    // Allow billing status check always
    if (ctx.path === '/api/billing/status') {
      await next();
      return;
    }
    
    // For main route, check subscription
    if (ctx.path === '/' && !hasActiveSubscription) {
      const shop = ctx.state.shop;
      const storeHandle = shop.replace('.myshopify.com', '');
      const appHandle = 'bgn2eur-price-display';
      
      const planSelectionUrl = `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
      
      ctx.set('Content-Type', 'text/html');
      ctx.body = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Redirecting to billing...</title>
          <meta name="shopify-api-key" content="${SHOPIFY_API_KEY}" />
          <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        </head>
        <body>
          <script>
            if (window.top !== window) {
              window.top.location.href = '${planSelectionUrl}';
            } else {
              window.location.href = '${planSelectionUrl}';
            }
          </script>
          <p>Redirecting to billing page...</p>
        </body>
        </html>
      `;
      return;
    }
    
    await next();
  } catch (error) {
    console.error('Subscription check error:', error);
    await next();
  }
}

// Simplified billing callback for managed pricing
router.get('/api/billing/callback', authenticateRequest, async (ctx) => {
  // Managed pricing handles everything, just redirect back
  ctx.redirect('/');
});

// Check subscription status endpoint
router.get('/api/billing/status', authenticateRequest, async (ctx) => {
  try {
    const client = new shopify.clients.Graphql({
      session: ctx.state.session,
    });
    
    const response = await client.query({
      data: `{
        currentAppInstallation {
          activeSubscriptions {
            id
            status
            name
          }
        }
      }`
    });
    
    const subscriptions = response.body.data.currentAppInstallation.activeSubscriptions || [];
    const hasActiveSubscription = subscriptions.some(sub => 
      sub.status === 'ACTIVE' || sub.status === 'PENDING'
    );
    
    ctx.body = {
      hasActiveSubscription,
      subscriptions,
      shop: ctx.state.shop
    };
  } catch (error) {
    console.error('Billing status error:', error);
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
});

// API endpoints
router.get('/api/test', authenticateRequest, async (ctx) => {
  console.log('=== API TEST ===');
  ctx.body = { 
    message: 'Success! Session is valid', 
    shop: ctx.state.shop,
    hasAccessToken: !!ctx.state.session.accessToken,
    scope: ctx.state.session.scope
  };
});

router.get('/api/shop', authenticateRequest, requiresSubscription, async (ctx) => {
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

router.get('/api/orders', authenticateRequest, requiresSubscription, async (ctx) => {
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

// Main app route - with subscription check
router.get('(/)', authenticateRequest, async (ctx) => {
  console.log('=== MAIN ROUTE ===');
  const shop = ctx.query.shop;
  const host = ctx.query.host;
  
  if (!shop) {
    ctx.body = "Missing shop parameter. Please install the app through Shopify.";
    ctx.status = 400;
    return;
  }
  
  // Проверка за subscription при първо зареждане
  try {
    const client = new shopify.clients.Graphql({
      session: ctx.state.session,
    });
    
    const response = await client.query({
      data: `{
        currentAppInstallation {
          id
          activeSubscriptions {
            id
            status
            name
          }
        }
      }`
    });
    
    const subscriptions = response.body.data.currentAppInstallation.activeSubscriptions || [];
    const hasActiveSubscription = subscriptions.some(sub => 
      sub.status === 'ACTIVE' || sub.status === 'PENDING'
    );
    
    console.log('Subscription check:', { 
      hasActiveSubscription, 
      subscriptionsCount: subscriptions.length 
    });
    
    // Ако няма subscription И това е нова инсталация или проверяваме billing
    if (!hasActiveSubscription && (ctx.query.check_billing === 'true' || ctx.query.billing !== 'declined')) {
      const storeHandle = shop.replace('.myshopify.com', '');
      const appHandle = 'bgn2eur-price-display';
      
      const planSelectionUrl = `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
      
      console.log('No subscription found, redirecting to plan selection:', planSelectionUrl);
      
      // ВАЖНО: Използваме meta refresh за да излезем от iframe
      ctx.set('Content-Type', 'text/html');
      ctx.body = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Select a plan - BGN/EUR Price Display</title>
          <meta http-equiv="refresh" content="0; url=${planSelectionUrl}">
          <meta name="shopify-api-key" content="${SHOPIFY_API_KEY}" />
          <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        </head>
        <body>
          <div style="text-align: center; padding: 50px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <h2>Select a plan to continue</h2>
            <p>Redirecting to plan selection...</p>
            <p style="margin-top: 20px;">
              <a href="${planSelectionUrl}" style="color: #2C6ECB;">Click here if not redirected automatically</a>
            </p>
          </div>
          <script>
            // Backup redirect methods
            setTimeout(function() {
              // Try parent redirect first
              if (window.parent && window.parent !== window) {
                window.parent.location.href = '${planSelectionUrl}';
              } else {
                window.location.href = '${planSelectionUrl}';
              }
            }, 1000);
            
            // App Bridge redirect as final backup
            setTimeout(function() {
              try {
                var AppBridge = window['app-bridge'];
                var actions = AppBridge.actions;
                var createApp = AppBridge.default;
                var app = createApp({
                  apiKey: '${SHOPIFY_API_KEY}',
                  host: '${host || ''}'
                });
                var redirect = actions.Redirect.create(app);
                redirect.dispatch(actions.Redirect.Action.REMOTE, '${planSelectionUrl}');
              } catch (e) {
                console.error('App Bridge redirect failed:', e);
              }
            }, 2000);
          </script>
        </body>
        </html>
      `;
      return;
    }
  } catch (error) {
    console.error('Subscription check error:', error);
    // При грешка продължаваме с зареждането
  }
  
  // Нормално зареждане на приложението
  ctx.set('Content-Type', 'text/html');
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
      background: #fafafa;
      color: #202223;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: white;
      border-radius: 8px;
      padding: 40px;
      text-align: center;
      margin-bottom: 24px;
      border: 1px solid #e1e3e5;
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
    .card {
      background: white;
      border-radius: 8px;
      padding: 32px;
      margin-bottom: 24px;
      border: 1px solid #e1e3e5;
    }
    .card h2 {
      margin: 0 0 24px 0;
      font-size: 24px;
      font-weight: 500;
      color: #202223;
    }
    .tabs {
      display: flex;
      gap: 32px;
      margin-bottom: 0;
      background: white;
      border-radius: 8px 8px 0 0;
      padding: 0 32px;
      border: 1px solid #e1e3e5;
      border-bottom: none;
    }
    .tab {
      padding: 20px 0;
      background: none;
      border: none;
      font-size: 15px;
      font-weight: 400;
      color: #616161;
      cursor: pointer;
      position: relative;
      transition: color 0.2s;
    }
    .tab:hover {
      color: #202223;
    }
    .tab.active {
      color: #202223;
      font-weight: 500;
    }
    .tab.active::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: #202223;
    }
    .tab-content {
      display: none;
      animation: fadeIn 0.3s;
    }
    .tab-content.active {
      display: block;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .quick-action {
      background: white;
      border: 1px solid #e1e3e5;
      border-radius: 8px;
      padding: 32px;
      text-align: center;
      margin-bottom: 24px;
    }
    .quick-action h3 {
      margin: 0 0 12px 0;
      font-size: 20px;
      font-weight: 500;
      color: #202223;
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
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 24px;
      margin-top: 24px;
    }
    .feature {
      padding: 20px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .feature:last-child {
      border-bottom: none;
    }
    .feature-text h3 {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: 500;
      color: #202223;
    }
    .feature-text p {
      margin: 0;
      color: #616161;
      font-size: 14px;
      line-height: 1.5;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      background: #f3f4f6;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      color: #616161;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge.new {
      background: #202223;
      color: white;
    }
    .warning {
      background: #f9fafb;
      border: 1px solid #e1e3e5;
      border-radius: 6px;
      padding: 20px;
      margin: 24px 0;
      line-height: 1.6;
    }
    .button {
      display: inline-block;
      padding: 10px 20px;
      background: #202223;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      margin-top: 16px;
      transition: background 0.2s;
    }
    .button:hover {
      background: #000;
    }
    .footer {
      text-align: center;
      color: #616161;
      font-size: 14px;
      margin-top: 40px;
      line-height: 1.6;
    }
    code {
      background: #f3f4f6;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 14px;
    }
    .loading {
      text-align: center;
      padding: 40px;
      color: #666;
      display: none;
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
    ul {
      line-height: 1.8;
    }
    strong {
      font-weight: 500;
      color: #202223;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BGN/EUR Price Display</h1>
      <p>Показвайте цените в лева и евро на Thank You страницата</p>
      <div class="loading" id="loading">Зареждане...</div>
      <span id="status-badge" style="display: none;" class="success-badge">✓ Активно</span>
    </div>

    <div class="quick-action">
      <h3>Бърз старт</h3>
      <p style="margin-bottom: 20px;">Инсталирайте extension-а с едно кликване:</p>
      <a href="https://${shop}/admin/themes/current/editor?context=checkout&template=checkout" 
         class="big-button" 
         target="_blank">
        Отвори Theme Editor
      </a>
    </div>

    <div class="tabs">
      <button class="tab active" onclick="showTab('installation')">Инсталация</button>
      <button class="tab" onclick="showTab('features')">Функции</button>
      <button class="tab" onclick="showTab('tips')">Съвети</button>
    </div>

    <div class="card">
      <div id="installation" class="tab-content active">
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

      <div id="features" class="tab-content">
        <h2>Как работи</h2>
        <div class="feature-grid">
          <div class="feature">
            <div class="feature-text">
              <h3>Двойно показване</h3>
              <p>Всички цени се показват едновременно в BGN и EUR, изчислени по фиксиран курс 1 EUR = 1.95583 BGN</p>
            </div>
          </div>
          <div class="feature">
            <div class="feature-text">
              <h3>Автоматично преминаване към EUR</h3>
              <p>След 01.01.2026 г. когато смените валутата на магазина (или на пазара България)  на евро, приложението автоматично ще показва EUR като основна валута и BGN като референтна.</p>
            </div>
          </div>
          <div class="feature">
            <div class="feature-text">
              <h3>Пълна разбивка</h3>
              <p>Включва всички елементи на поръчката - продукти, доставка и обща сума</p>
            </div>
          </div>
        </div>
        
        <div class="warning">
          <div>
            <strong>Важно:</strong> В настройките на магазина трябва да имате България като отделен пазар. Цените в BGN/EUR се показват само за поръчки в български лева (BGN) с адрес на доставка в България.
          </div>
        </div>
      </div>

      <div id="tips" class="tab-content">
        <h2>Полезни съвети</h2>
        <ul style="margin: 0; padding-left: 20px;">
          <li>Уверете се, че валутата на магазина е настроена на BGN</li>
          <li>Тествайте с реална поръчка за да видите как изглежда</li>
          <li>При проблеми, опитайте да деинсталирате и инсталирате отново</li>
          <li>Проверете дали extension-а е активен в Theme Customizer</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <p>BGN/EUR Prices Display v1.0 • Създадено за български онлайн магазини</p>
      <p style="margin-top: 8px;">Нужда от помощ? Свържете се с нас на emarketingbg@gmail.com</p>
    </div>
  </div>
  
  <script>
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
    
    function showTab(tabName) {
      // Hide all tabs
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
      });
      
      // Show selected tab
      document.getElementById(tabName).classList.add('active');
      event.target.classList.add('active');
    }
    
    // Load app data after page loads
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
      hasToken: !!session.accessToken && session.accessToken !== 'placeholder',
      scope: session.scope
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
    sessions: allSessions,
    totalSessions: allSessions.length
  };
});

// Public debug endpoint за проверка на billing
router.get('/debug/billing/:shop', async (ctx) => {
  const shop = ctx.params.shop;
  
  try {
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    const offlineSession = sessions.find(s => !s.isOnline);
    
    if (!offlineSession) {
      ctx.body = {
        error: 'No offline session found',
        shop: shop,
        totalSessions: sessions.length,
        sessionTypes: sessions.map(s => ({ 
          id: s.id, 
          isOnline: s.isOnline,
          hasToken: !!s.accessToken
        }))
      };
      return;
    }
    
    const client = new shopify.clients.Graphql({
      session: offlineSession,
    });
    
    const response = await client.query({
      data: `{
        currentAppInstallation {
          id
          activeSubscriptions {
            id
            status
            name
            test
            trialDays
            createdAt
          }
        }
      }`
    });
    
    ctx.body = {
      shop: shop,
      sessionId: offlineSession.id,
      hasToken: !!offlineSession.accessToken,
      installation: response.body.data.currentAppInstallation
    };
    
  } catch (error) {
    ctx.status = 500;
    ctx.body = {
      error: error.message,
      shop: shop
    };
  }
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