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
console.log('HOST_NAME:', process.env.HOST_NAME);
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

// Public debug endpoint (без автентикация) - САМО ЗА ДЕБЪГ!
router.get('/public/billing/debug/:shop', async (ctx) => {
  const shop = ctx.params.shop;
  
  try {
    // Намираме сесията за този магазин
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    const session = sessions.find(s => !s.isOnline);
    
    if (!session || !session.accessToken) {
      ctx.body = {
        error: 'No valid session found',
        shop: shop,
        sessionsCount: sessions.length,
        hasSession: !!session,
        hasToken: session ? !!session.accessToken : false
      };
      return;
    }
    
    const client = new GraphqlClient({
      domain: shop,
      accessToken: session.accessToken,
    });
    
    const checkResponse = await client.query({
      data: `{
        currentAppInstallation {
          id
          activeSubscriptions {
            id
            name
            status
            test
            trialDays
            createdAt
          }
        }
      }`
    });
    
    ctx.body = {
      shop: shop,
      installation: checkResponse.body.data.currentAppInstallation,
      hasAccessToken: !!session.accessToken,
      sessionId: session.id,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Public debug error:', error);
    ctx.status = 500;
    ctx.body = { 
      error: error.message,
      shop: shop,
      stack: error.stack 
    };
  }
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
  const shop = dest.hostname;
  
  const sessions = await memorySessionStorage.findSessionsByShop(shop);
  let session = sessions.find(s => !s.isOnline);
  
  if (!session || !session.accessToken || session.accessToken === 'placeholder') {
    console.log('No valid session with access token, performing token exchange...');
    
    try {
      const tokenExchangeResult = await shopify.auth.tokenExchange({
        shop: shop,
        sessionToken: encodedSessionToken,
        requestedTokenType: 'offline_access_token',
      });
      
      console.log('Token exchange successful');
      
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
  
  ctx.state.shop = shop;
  ctx.state.session = session;
  
  await next();
}

// Billing check middleware for main route
async function checkBillingOnAppLoad(ctx, next) {
  console.log('=== CHECK BILLING ON APP LOAD ===');
  console.log('Path:', ctx.path);
  console.log('Query:', ctx.query);
  
  // Skip billing check for auth and callback routes
  if (ctx.path === '/auth' || ctx.path === '/auth/callback' || ctx.path.startsWith('/api/billing')) {
    console.log('Skipping billing check for auth/callback/billing routes');
    await next();
    return;
  }
  
  // Skip if no shop parameter
  const shop = ctx.query.shop;
  if (!shop) {
    console.log('No shop parameter, skipping billing check');
    await next();
    return;
  }
  
  // If already in billing mode, skip the check
  if (ctx.query.billing === 'required') {
    console.log('Already in billing mode, skipping check');
    await next();
    return;
  }
  
  console.log('Starting billing check for shop:', shop);
  
  try {
    // Check if we have a valid session
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    const session = sessions.find(s => !s.isOnline);
    
    console.log('Sessions found:', sessions.length);
    console.log('Valid session found:', !!session);
    console.log('Session has access token:', !!(session && session.accessToken));
    
    if (!session || !session.accessToken) {
      // No session, let the normal flow handle it
      console.log('No valid session found, continuing...');
      await next();
      return;
    }
    
    console.log('Checking subscriptions for shop:', shop);
    
    // Check for active subscriptions
    const client = new GraphqlClient({
      domain: shop,
      accessToken: session.accessToken,
    });
    
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
    console.log('Found subscriptions:', subscriptions.length);
    
    // Check for valid subscription
    const hasValidSubscription = subscriptions.some(sub => {
      console.log('Checking subscription:', sub.id, 'status:', sub.status, 'trialDays:', sub.trialDays);
      
      if (sub.status === 'ACTIVE') {
        console.log('Found ACTIVE subscription');
        return true;
      }
      
      if (sub.status === 'PENDING' && sub.trialDays > 0) {
        const trialEndDate = new Date(sub.createdAt);
        trialEndDate.setDate(trialEndDate.getDate() + sub.trialDays);
        const isValid = new Date() < trialEndDate;
        console.log('PENDING subscription with trial, valid:', isValid);
        return isValid;
      }
      
      return false;
    });
    
    // If no valid subscription, redirect to billing
    if (!hasValidSubscription) {
      console.log('No active subscription found, redirecting to billing');
      ctx.redirect(`/?billing=required&shop=${shop}`);
      return;
    }
    
    console.log('Active subscription found, continuing...');
    await next();
    
  } catch (error) {
    console.error('Billing check error:', error);
    // On error, allow access but show billing prompt
    ctx.state.showBillingPrompt = true;
    await next();
  }
}

// Billing check middleware for API endpoints
async function requiresSubscription(ctx, next) {
  try {
    const client = new GraphqlClient({
      domain: ctx.state.shop,
      accessToken: ctx.state.session.accessToken,
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
    
    // Check for valid subscription
    const hasValidSubscription = subscriptions.some(sub => {
      if (sub.status === 'ACTIVE') return true;
      
      if (sub.status === 'PENDING' && sub.trialDays > 0) {
        const trialEndDate = new Date(sub.createdAt);
        trialEndDate.setDate(trialEndDate.getDate() + sub.trialDays);
        return new Date() < trialEndDate;
      }
      
      return false;
    });
    
    ctx.state.hasActiveSubscription = hasValidSubscription;
    
    // Always allow access to billing endpoints
    if (ctx.path.includes('/api/billing') || ctx.path.includes('/api/subscription')) {
      await next();
      return;
    }
    
    // Check if needs subscription
    if (!hasValidSubscription && ctx.path !== '/') {
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

// Billing endpoints
router.get('/api/billing/create', authenticateRequest, async (ctx) => {
  console.log('=== BILLING CREATE ===');
  console.log('Shop:', ctx.state.shop);
  console.log('Has access token:', !!ctx.state.session.accessToken);
  console.log('Access token length:', ctx.state.session.accessToken?.length);
  
  try {
    const client = new GraphqlClient({
      domain: ctx.state.shop,
      accessToken: ctx.state.session.accessToken,
    });
    
    const TEST_MODE = process.env.NODE_ENV !== 'production';
    console.log('Test mode:', TEST_MODE);
    console.log('NODE_ENV:', process.env.NODE_ENV);
    
    // ВАЖНО: Този URL трябва да е добавен в Allowed redirection URLs в Partner Dashboard
    const returnUrl = `${HOST}/api/billing/callback`;
    console.log('Billing return URL:', returnUrl);
    console.log('HOST:', HOST);
    
    const mutation = `mutation {
      appSubscriptionCreate(
        name: "BGN/EUR Price Display"
        trialDays: 5
        test: ${TEST_MODE}
        returnUrl: "${returnUrl}"
        lineItems: [{
          plan: {
            appRecurringPricingDetails: {
              price: { amount: 14.99, currencyCode: USD }
              interval: EVERY_30_DAYS
            }
          }
        }]
      ) {
        appSubscription {
          id
          name
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }`;
    
    console.log('GraphQL mutation:', mutation);
    
    const response = await client.query({
      data: mutation
    });
    
    console.log('GraphQL response status:', response.status);
    console.log('GraphQL response body:', JSON.stringify(response.body, null, 2));
    
    if (response.body.errors) {
      console.error('GraphQL errors:', response.body.errors);
      ctx.status = 500;
      ctx.body = { error: 'GraphQL error: ' + response.body.errors[0].message };
      return;
    }
    
    const { confirmationUrl, userErrors } = response.body.data.appSubscriptionCreate;
    
    if (userErrors?.length > 0) {
      console.error('Billing errors:', userErrors);
      ctx.status = 400;
      ctx.body = { error: userErrors[0].message };
      return;
    }
    
    console.log('Billing confirmation URL:', confirmationUrl);
    ctx.body = { confirmationUrl };
  } catch (error) {
    console.error('Create subscription error:', error);
    console.error('Error stack:', error.stack);
    ctx.status = 500;
    ctx.body = { error: 'Failed to create subscription: ' + error.message };
  }
});

router.get('/api/billing/callback', authenticateRequest, async (ctx) => {
  const { charge_id } = ctx.query;
  
  if (charge_id) {
    // Subscription was accepted
    console.log('Subscription activated:', charge_id);
    ctx.redirect('/?billing=success');
  } else {
    // Subscription was declined
    ctx.redirect('/?billing=declined');
  }
});

// Check subscription status endpoint
router.get('/api/billing/status', authenticateRequest, requiresSubscription, async (ctx) => {
  ctx.body = {
    hasActiveSubscription: ctx.state.hasActiveSubscription,
    shop: ctx.state.shop
  };
});

// Debug billing endpoint
router.get('/api/billing/test', authenticateRequest, async (ctx) => {
  try {
    const client = new GraphqlClient({
      domain: ctx.state.shop,
      accessToken: ctx.state.session.accessToken,
    });
    
    // Проверяваме какви subscriptions има
    const checkResponse = await client.query({
      data: `{
        currentAppInstallation {
          id
          activeSubscriptions {
            id
            name
            status
            test
            trialDays
            createdAt
          }
        }
      }`
    });
    
    ctx.body = {
      shop: ctx.state.shop,
      installation: checkResponse.body.data.currentAppInstallation,
      hasAccessToken: !!ctx.state.session.accessToken,
      sessionInfo: {
        id: ctx.state.session.id,
        shop: ctx.state.session.shop,
        isOnline: ctx.state.session.isOnline,
        scope: ctx.state.session.scope
      }
    };
  } catch (error) {
    console.error('Billing test error:', error);
    ctx.status = 500;
    ctx.body = { 
      error: error.message,
      shop: ctx.state.shop 
    };
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

// Main app route
router.get('(/)', checkBillingOnAppLoad, async (ctx) => {
  console.log('=== MAIN ROUTE ===');
  const shop = ctx.query.shop;
  const host = ctx.query.host;
  const billingRequired = ctx.query.billing === 'required';
  
  console.log('Shop:', shop);
  console.log('Host:', host);
  console.log('Billing required:', billingRequired);
  
  if (!shop) {
    ctx.body = "Missing shop parameter. Please install the app through Shopify.";
    ctx.status = 400;
    return;
  }
  
  // Check if we have a valid session
  const sessions = await memorySessionStorage.findSessionsByShop(shop);
  const session = sessions.find(s => !s.isOnline);
  
  console.log('Session found:', !!session);
  console.log('Session has access token:', !!(session && session.accessToken));
  
  ctx.set('Content-Type', 'text/html');
  ctx.body = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BGN/EUR Price Display</title>
  <meta name="shopify-api-key" content="${SHOPIFY_API_KEY}" />
  <script src="https://unpkg.com/@shopify/app-bridge@2"></script>
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
    .billing-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .billing-modal {
      background: white;
      border-radius: 12px;
      padding: 40px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
    }
    .billing-modal h2 {
      margin: 0 0 16px 0;
      font-size: 24px;
      color: #202223;
    }
    .billing-modal p {
      margin: 0 0 24px 0;
      color: #616161;
      line-height: 1.6;
    }
    .billing-features {
      text-align: left;
      margin: 24px 0;
    }
    .billing-features li {
      margin-bottom: 8px;
      color: #616161;
    }
  </style>
</head>
<body>
  ${billingRequired ? `
  <div class="billing-overlay" id="billing-overlay">
    <div class="billing-modal">
      <h2>🎁 Започнете безплатен пробен период</h2>
      <p>За да използвате BGN/EUR Price Display, трябва да активирате плана.</p>
      
      <div class="billing-features">
        <ul>
          <li>✓ 5-дневен безплатен пробен период</li>
          <li>✓ Показване на цени в BGN и EUR</li>
          <li>✓ Автоматично преминаване към EUR след 2026</li>
          <li>✓ Пълна разбивка на поръчката</li>
        </ul>
      </div>
      
      <p><strong>След пробния период: $14.99/месец</strong><br>
      Можете да отмените по всяко време</p>
      
      <button onclick="startBilling()" class="big-button" style="background: #202223; margin-right: 12px;">
        Започни безплатен пробен период
      </button>
      
      <button onclick="closeBillingModal()" style="background: transparent; border: 1px solid #e1e3e5; color: #616161;">
        Затвори
      </button>
    </div>
  </div>
  ` : ''}

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
    // Initialize App Bridge
    const urlParams = new URLSearchParams(window.location.search);
    const host = urlParams.get('host');
    const shop = urlParams.get('shop');
    
    // Wait for AppBridge to load
    function waitForAppBridge() {
      if (typeof AppBridge !== 'undefined') {
        initializeApp();
      } else {
        setTimeout(waitForAppBridge, 100);
      }
    }
    
    function initializeApp() {
      if (host && shop) {
        const app = AppBridge.createApp({
          apiKey: '${SHOPIFY_API_KEY}',
          host: host,
          forceRedirect: true,
        });
        
        // Check if we have a valid session
        const hasSession = ${!!(session && session.accessToken)};
        
        if (!hasSession) {
          // Redirect to auth using App Bridge
          AppBridge.actions.Redirect.create(app).dispatch(
            AppBridge.actions.Redirect.Action.REMOTE,
            '${HOST}/auth?shop=' + shop
          );
        }
      }
    }
    
    // Start waiting for AppBridge
    waitForAppBridge();
    
    let billingStatus = null;
    
    async function loadAppData() {
      try {
        const response = await fetch('/api/shop?shop=${shop}');
        if (response.ok) {
          const data = await response.json();
          console.log('Shop data loaded:', data);
          document.getElementById('loading').style.display = 'none';
          document.getElementById('status-badge').style.display = 'inline-block';
          
          // Check billing status
          checkBillingStatus();
        } else {
          console.error('Failed to load shop data');
          document.getElementById('loading').innerHTML = 'Грешка при зареждане';
          
          // ВАЖНО: Показваме billing при redirect
          if (response.status === 302 || response.redirected) {
            showBillingPrompt();
          }
        }
      } catch (error) {
        console.error('Error loading app data:', error);
        // При мрежова грешка също проверяваме billing
        checkBillingStatus();
      }
    }
    
    async function checkBillingStatus() {
      try {
        const response = await fetch('/api/billing/status?shop=${shop}');
        if (response.ok) {
          const data = await response.json();
          billingStatus = data.hasActiveSubscription;
          
          if (!billingStatus) {
            showBillingPrompt(); // Показваме prompt ако няма активен план
          }
        } else if (response.status === 302) {
          // Ако сме redirected, показваме billing prompt
          showBillingPrompt();
        }
      } catch (error) {
        console.error('Error checking billing:', error);
        // При грешка също показваме billing prompt
        showBillingPrompt();
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
        const response = await fetch('/api/billing/create?shop=${shop}');
        const data = await response.json();
        
        if (data.confirmationUrl) {
          // ВАЖНО: Пренасочваме към Shopify billing page
          window.top.location.href = data.confirmationUrl;
        } else {
          alert('Грешка при стартиране на пробен период. Моля опитайте отново.');
        }
      } catch (error) {
        console.error('Billing error:', error);
        alert('Грешка при стартиране на пробен период. Моля опитайте отново.');
      }
    }
    
    function closeBillingModal() {
      const overlay = document.getElementById('billing-overlay');
      if (overlay) {
        overlay.style.display = 'none';
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
    sessions: allSessions
  };
});

// OAuth flow for embedded apps
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
    console.log('Creating OAuth URL...');
    // For embedded apps, we need to use App Bridge redirect
    const authUrl = `https://${shop}/admin/oauth/authorize?` + 
      `client_id=${SHOPIFY_API_KEY}&` +
      `scope=${SCOPES}&` +
      `redirect_uri=${encodeURIComponent(HOST + '/auth/callback')}&` +
      `state=${Math.random().toString(36).substring(7)}`;
    
    console.log('OAuth URL generated:', authUrl);
    ctx.redirect(authUrl);
  } catch (error) {
    console.error('Error creating OAuth URL:', error);
    ctx.status = 500;
    ctx.body = 'Auth initialization failed: ' + error.message;
  }
});

// OAuth callback
router.get('/auth/callback', async (ctx) => {
  console.log('=== AUTH CALLBACK ===');
  console.log('Callback query:', ctx.query);
  
  const { code, hmac, shop, state, timestamp } = ctx.query;
  
  if (!code || !shop) {
    console.error('Missing required OAuth parameters');
    ctx.status = 400;
    ctx.body = 'Missing required OAuth parameters';
    return;
  }
  
  try {
    console.log('Exchanging code for access token...');
    
    // Exchange code for access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code: code,
      }),
    });
    
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }
    
    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful for shop:', shop);
    
    // Create session - use Session class directly
    const session = new Session({
      id: `${shop}-offline`,
      shop: shop,
      state: state,
      isOnline: false,
      accessToken: tokenData.access_token,
      scope: tokenData.scope,
    });
    
    // Store session
    await memorySessionStorage.storeSession(session);
    console.log('Session stored successfully');
    
    // Redirect to app
    const redirectUrl = `/?shop=${shop}&host=${ctx.query.host}`;
    console.log('Redirecting to:', redirectUrl);
    ctx.redirect(redirectUrl);
    
  } catch (error) {
    console.error("Auth callback failed:", error);
    ctx.status = 500;
    ctx.body = 'Authentication failed: ' + error.message;
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