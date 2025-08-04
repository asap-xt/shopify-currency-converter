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
  HOST
} = process.env;

// Validation
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SCOPES || !HOST) {
  console.error('FATAL: Missing required environment variables!');
  console.error('Missing:', {
    SHOPIFY_API_KEY: !SHOPIFY_API_KEY,
    SHOPIFY_API_SECRET: !SHOPIFY_API_SECRET,
    SCOPES: !SCOPES,
    HOST: !HOST
  });
  process.exit(1);
}

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: SHOPIFY_API_KEY,
  apiSecretKey: SHOPIFY_API_SECRET,
  scopes: SCOPES.split(','),
  hostName: HOST.replace('https://', ''),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  sessionStorage: memorySessionStorage,
  // For public apps, we need to handle both online and offline tokens
  useOnlineTokens: false,
  // Enable managed pricing support
  future: {
    unstable_managedPricingSupport: true,
  },
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

// CORS middleware
app.use(async (ctx, next) => {
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  if (ctx.method === 'OPTIONS') {
    ctx.status = 200;
    return;
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
  let shop = dest.hostname;

  // Fallback: use shop from query parameter if available
  const queryShop = ctx.query.shop;
  if (queryShop && queryShop !== shop) {
    console.log(`Shop mismatch: session token shop (${shop}) vs query shop (${queryShop})`);
    // Use the shop from query parameter as it's more reliable for API calls
    shop = queryShop;
  }

  const sessions = await memorySessionStorage.findSessionsByShop(shop);
  let session = sessions.find(s => !s.isOnline);

  if (!session || !session.accessToken || session.accessToken === 'placeholder') {
    console.log('No valid session with access token, performing token exchange...');

    try {
      console.log('=== TOKEN EXCHANGE DEBUG ===');
      console.log('Shop:', shop);
      console.log('Session token length:', encodedSessionToken.length);
      console.log('Session token starts with:', encodedSessionToken.substring(0, 20));
      console.log('API Key set:', !!SHOPIFY_API_KEY);
      console.log('API Secret set:', !!SHOPIFY_API_SECRET);
      console.log('Host name:', HOST.replace('https://', ''));
      console.log('Scopes:', SCOPES);

      const tokenExchangeResult = await shopify.auth.tokenExchange({
        shop: shop,
        sessionToken: encodedSessionToken,
      });

      console.log('Token exchange successful');
      console.log('Token exchange result:', {
        hasAccessToken: !!tokenExchangeResult.accessToken,
        accessTokenLength: tokenExchangeResult.accessToken?.length,
        scope: tokenExchangeResult.scope,
        expires: tokenExchangeResult.expires,
        associatedUser: tokenExchangeResult.associatedUser,
        accountOwner: tokenExchangeResult.accountOwner
      });

      if (!tokenExchangeResult.accessToken) {
        console.error('Token exchange succeeded but no access token received');
        ctx.status = 500;
        ctx.body = 'Token exchange failed - no access token';
        return;
      }

      const sessionId = `offline_${shop}`;
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
      console.error('Error details:', {
        message: error.message,
        statusCode: error.response?.statusCode,
        body: error.response?.body,
        headers: error.response?.headers
      });

      // Check if it's a configuration issue
      if (error.message.includes('400 Bad Request')) {
        console.error('Token exchange 400 error - possible causes:');
        console.error('1. App not properly configured in Partner Dashboard');
        console.error('2. Incorrect API key or secret');
        console.error('3. App URL not matching configuration');
        console.error('4. Missing required scopes');
        console.error('5. App not installed in the store');
      }

      ctx.status = 500;
      ctx.body = 'Token exchange failed';
      return;
    }
  }

  ctx.state.shop = shop;
  ctx.state.session = session;

  await next();
}

// Billing check middleware
async function requiresSubscription(ctx, next) {
  try {
    const client = new shopify.clients.Graphql({
      session: ctx.state.session,
    });

    // Check for active subscriptions
    const response = await client.query({
      data: `{
        currentAppInstallation {
          activeSubscriptions {
            id
            status
            trialDays
            createdAt
          }
        }
      }`
    });

    const subscriptions = response.body.data.currentAppInstallation.activeSubscriptions || [];
    const hasActiveSubscription = subscriptions.some(sub => sub.status === 'ACTIVE');

    ctx.state.hasActiveSubscription = hasActiveSubscription;

    // Always allow access to billing endpoints
    if (ctx.path.includes('/api/billing') || ctx.path.includes('/api/subscription')) {
      await next();
      return;
    }

    // Check if needs subscription
    if (!hasActiveSubscription && ctx.path !== '/') {
      ctx.redirect('/?billing=required');
      return;
    }

    await next();
  } catch (error) {
    console.error('Subscription check error:', error);
    // Allow access on error to prevent blocking
    await next();
  }
}

router.get("/billing/confirm", async (ctx) => {
  const { shop } = ctx.query;
  ACTIVE_SUBSCRIPTION[shop] = true;
  ctx.body = "Абонаментът е активиран! 🎉 Можеш да ползваш приложението.";
});

// Billing endpoints
router.get('/api/billing/create', authenticateRequest, async (ctx) => {
  try {
    console.log('=== BILLING CREATE DEBUG ===');
    const shop = ctx.query.shop;
    if (!shop) {
      ctx.status = 400;
      ctx.body = { error: 'Missing shop parameter' };
      return;
    }

    console.log('Creating billing for shop:', shop);

    // Create a proper billing subscription using GraphQL
    const client = new shopify.clients.Graphql({
      session: ctx.state.session,
    });

    const response = await client.query({
      data: `mutation {
        appSubscriptionCreate(
          name: "Pro Plan"
          returnUrl: "${HOST}/api/billing/callback?shop=${shop}"
          lineItems: [{
            plan: {
              appRecurringPricingDetails: {
                price: { amount: 14.99, currencyCode: "USD" }
                interval: EVERY_30_DAYS
              }
            }
          }]
        ) {
          confirmationUrl
          appSubscription { id }
          userErrors { message }
        }
      }`
    });

    const { confirmationUrl, userErrors } = response.body.data.appSubscriptionCreate;

    if (userErrors?.length > 0) {
      console.error('Billing errors:', userErrors);
      ctx.status = 400;
      ctx.body = { error: userErrors[0].message };
      return;
    }

    ctx.body = { confirmationUrl };
  } catch (error) {
    console.error('Create subscription error:', error);
    ctx.status = 500;
    ctx.body = { error: 'Failed to create subscription' };
  }
});

router.get('/api/billing/callback', async (ctx) => {
  const { charge_id, shop } = ctx.query;

  if (charge_id) {
    // Subscription was accepted
    console.log('Subscription activated:', charge_id);
    ACTIVE_SUBSCRIPTION[shop] = true;
    ctx.redirect(`/?shop=${shop}&billing=success`);
  } else {
    // Subscription was declined
    ctx.redirect(`/?shop=${shop}&billing=declined`);
  }
});

// Check subscription status endpoint
router.get('/api/billing/status', async (ctx) => {
  const shop = ctx.query.shop;

  if (!shop) {
    ctx.status = 400;
    ctx.body = { error: 'Missing shop parameter' };
    return;
  }

  // Check if shop has active subscription
  const hasActiveSubscription = ACTIVE_SUBSCRIPTION[shop] || false;

  ctx.body = {
    hasActiveSubscription: hasActiveSubscription,
    shop: shop
  };
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

router.get('/api/shop', async (ctx) => {
  console.log('=== SHOP INFO API ===');
  const shop = ctx.query.shop;

  if (!shop) {
    ctx.status = 400;
    ctx.body = { error: 'Missing shop parameter' };
    return;
  }

  // For now, just return basic info without making API calls
  // This avoids authentication issues
  ctx.body = {
    success: true,
    shop: {
      name: shop,
      domain: shop,
      email: 'admin@' + shop
    }
  };
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

const APP_PLAN_NAME = "Pro Plan";
const APP_PRICE = 14.99;
const CURRENCY = "USD";
let ACTIVE_SUBSCRIPTION = {}; // тестово — в реално приложение запази в база

router.get("/auth/callback", async (ctx) => {
  const { shop, code, state } = ctx.query;

  console.log("🚀 Влязохме в /auth/callback за магазин:", shop);

  // Разменяме code за access token
  const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  });
  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token;

  // Ако няма активен subscription → създаваме
  if (!ACTIVE_SUBSCRIPTION[shop]) {
    const subscriptionResp = await fetch(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation {
              appSubscriptionCreate(
                name: "${APP_PLAN_NAME}"
                returnUrl: "${HOST}/api/billing/callback?shop=${shop}"
                lineItems: [{
                  plan: {
                    appRecurringPricingDetails: {
                      price: { amount: ${APP_PRICE}, currencyCode: ${CURRENCY} }
                      interval: EVERY_30_DAYS
                    }
                  }
                }]
              ) {
                confirmationUrl
                appSubscription { id }
                userErrors { message }
              }
            }
          `,
        }),
      }
    );

    const subData = await subscriptionResp.json();
    console.log("Shopify subscription response:", subData);

    const confirmationUrl =
      subData.data.appSubscriptionCreate.confirmationUrl;

    // Пренасочваме търговеца към потвърждаване
    ctx.redirect(confirmationUrl);
    return;
  }

  // Ако вече е абониран
  ctx.redirect(`${HOST}/?shop=${shop}`);
});

// Main app route
router.get('(/)', async (ctx) => {
  console.log('=== MAIN ROUTE ===');
  const shop = ctx.query.shop; // Използваме shop от query параметър
  const host = ctx.query.host;

  if (!shop) {
    ctx.body = "Missing shop parameter. Please install the app through Shopify.";
    ctx.status = 400;
    return;
  }

  // Check if this is a billing callback
  const { billing } = ctx.query;
  if (billing === 'success') {
    console.log('Billing success callback received');
    ACTIVE_SUBSCRIPTION[shop] = true;
  }

  if (!ACTIVE_SUBSCRIPTION[shop]) {
    console.log("Нямаш активен абонамент.");

    // Check if we should initiate billing
    const { initiate_billing } = ctx.query;
    if (initiate_billing === 'true') {
      console.log('Initiating billing for shop:', shop);

      // Redirect to billing creation
      ctx.redirect(`/api/billing/create?shop=${shop}`);
      return;
    }
  }

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
    let billingStatus = null;
    
         async function loadAppData() {
       console.log('loadAppData called');
       try {
         const url = '/api/shop?shop=${shop}';
         console.log('Fetching:', url);
         const response = await fetch(url);
         console.log('Response status:', response.status);
         console.log('Response ok:', response.ok);
         
         if (response.ok) {
           const data = await response.json();
           console.log('Shop data loaded:', data);
           document.getElementById('loading').style.display = 'none';
           document.getElementById('status-badge').style.display = 'inline-block';
           
           // Check billing status
           checkBillingStatus();
         } else {
           console.error('Failed to load shop data, status:', response.status);
           const errorText = await response.text();
           console.error('Error response:', errorText);
           document.getElementById('loading').innerHTML = 'Грешка при зареждане';
         }
       } catch (error) {
         console.error('Error loading app data:', error);
         document.getElementById('loading').innerHTML = 'Грешка при зареждане';
       }
     }
    
         async function checkBillingStatus() {
       console.log('checkBillingStatus called');
       try {
         const url = '/api/billing/status?shop=${shop}';
         console.log('Fetching billing status:', url);
         const response = await fetch(url);
         console.log('Billing response status:', response.status);
         console.log('Billing response ok:', response.ok);
         
         if (response.ok) {
           const data = await response.json();
           billingStatus = data.hasActiveSubscription;
           console.log('Billing status:', billingStatus);
           if (!billingStatus) {
             showBillingPrompt();
           }
         } else {
           console.error('Failed to check billing status, status:', response.status);
           const errorText = await response.text();
           console.error('Billing error response:', errorText);
         }
       } catch (error) {
         console.error('Error checking billing:', error);
       }
     }
    
    function showBillingPrompt() {
      const billingPrompt = \`
        <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 24px; margin-bottom: 24px; text-align: center;">
          <h3 style="margin: 0 0 16px 0; color: #856404;">🎁 Започнете 5-дневен безплатен пробен период</h3>
          <p style="margin: 0 0 20px 0; color: #856404;">
            След пробния период: $14.99/месец<br>
            Можете да отмените по всяко време
          </p>
          <button onclick="startBilling()" class="big-button" style="background: #ffc107; color: #212529;">
            Започни безплатен пробен период
          </button>
          <br><br>
          <a href="/api/billing/create?shop=${shop}" class="big-button" style="background: #28a745; color: white; text-decoration: none; display: inline-block; margin-top: 10px;">
            Директно стартиране на абонамент
          </a>
        </div>
      \`;
      
      // Insert billing prompt before main content
      const container = document.querySelector('.container');
      const header = document.querySelector('.header');
      header.insertAdjacentHTML('afterend', billingPrompt);
      
      // Hide main functionality
      document.querySelector('.quick-action').style.opacity = '0.5';
      document.querySelector('.quick-action').style.pointerEvents = 'none';
    }
    
    async function startBilling() {
      try {
        // Get session token from Shopify App Bridge
        const sessionToken = window.shopify?.config?.sessionToken;
        if (!sessionToken) {
          alert('Грешка: Няма session token. Моля опитайте отново.');
          return;
        }

        const response = await fetch('/api/billing/create?shop=${shop}', {
          headers: {
            'Authorization': 'Bearer ' + sessionToken,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Billing data:', data);
        if (data.confirmationUrl) {
          // Redirect to Shopify billing page
          window.top.location.href = data.confirmationUrl;
        } else {
          alert('Грешка при стартиране на пробен период. Моля опитайте отново.');
        }
      } catch (error) {
        console.error('Billing error:', error);
        alert('Грешка при стартиране на пробен период. Моля опитайте отново.');
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
    
    // Check URL parameters for billing status
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('billing') === 'success') {
      alert('🎉 Успешно активирахте плана! Вече можете да използвате всички функции.');
    } else if (urlParams.get('billing') === 'declined') {
      alert('❌ Плащането беше отказано. Моля опитайте отново.');
    }
    
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
    sessions: allSessions,
    queryShop: ctx.query.shop
  };
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', function () {
  console.log(`✓ Server listening on port ${PORT}`);
  console.log(`✓ Using Token Exchange authentication (Shopify managed install)`);
  console.log(`✓ App URL: ${HOST}`);
}).on('error', (err) => {
  console.error('FATAL: Server failed to start:', err);
  process.exit(1);
});