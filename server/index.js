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
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SCOPES || (!HOST && !HOST_NAME)) {
  console.error('FATAL: Missing required environment variables!');
  console.error('Missing:', {
    SHOPIFY_API_KEY: !SHOPIFY_API_KEY,
    SHOPIFY_API_SECRET: !SHOPIFY_API_SECRET,
    SCOPES: !SCOPES,
    HOST: !HOST,
    HOST_NAME: !HOST_NAME
  });
  process.exit(1);
}

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: SHOPIFY_API_KEY,
  apiSecretKey: SHOPIFY_API_SECRET,
  scopes: SCOPES.split(','),
  hostName: HOST_NAME || HOST,
  apiVersion: '2024-10',
  isEmbeddedApp: true,
  sessionStorage: memorySessionStorage,
  // Enable token exchange for managed install
  useOnlineTokens: false,
  // Enable managed pricing support
  future: {
    unstable_managedPricingSupport: true,
  },
});

console.log('Shopify API initialized');

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
  const start = Date.now();
  console.log(`${new Date().toISOString()} - ${ctx.method} ${ctx.path}`);
  try {
    await next();
    const duration = Date.now() - start;
    console.log(`${new Date().toISOString()} - ${ctx.method} ${ctx.path} - ${ctx.status} - ${duration}ms`);
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`Error handling ${ctx.method} ${ctx.path} - ${duration}ms:`, err);
    ctx.status = 500;
    ctx.body = 'Internal Server Error';
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
  const start = Date.now();
  
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
  console.log('Found sessions for shop:', shop, 'Count:', sessions.length);
  sessions.forEach(s => {
    console.log('Session:', { id: s.id, isOnline: s.isOnline, hasAccessToken: !!s.accessToken });
  });
  
  let session = sessions.find(s => !s.isOnline);
  
  if (!session || !session.accessToken || session.accessToken === 'placeholder') {
    console.log('No valid session with access token, performing token exchange...');
    
    try {
      console.log('Starting token exchange for shop:', shop);
      console.log('Session token length:', encodedSessionToken.length);
      console.log('Shopify API config:', {
        apiKey: SHOPIFY_API_KEY ? 'SET' : 'NOT SET',
        apiSecretKey: SHOPIFY_API_SECRET ? 'SET' : 'NOT SET',
        scopes: SCOPES,
        hostName: HOST_NAME,
        parsedScopes: SCOPES.split(','),
        requiredScopes: ['read_orders', 'write_themes', 'read_locations']
      });
      
      // Check if all required scopes are present
      const requiredScopes = ['read_orders', 'write_themes', 'read_locations'];
      const currentScopes = SCOPES.split(',');
      const missingScopes = requiredScopes.filter(scope => !currentScopes.includes(scope));
      
      if (missingScopes.length > 0) {
        console.error('Missing required scopes:', missingScopes);
        console.error('Current scopes:', currentScopes);
        console.error('Please add missing scopes in Partner Dashboard');
      }
      
      // Check App URL configuration
      console.log('App URL configuration check:');
      console.log('- Current HOST:', HOST);
      console.log('- Current HOST_NAME:', HOST_NAME);
      console.log('- Expected App URL in Partner Dashboard:', HOST_NAME || HOST);
      console.log('- Expected callback URL:', `${HOST_NAME || HOST}/auth/callback`);
      
      const tokenExchangeResult = await shopify.auth.tokenExchange({
        shop: shop,
        sessionToken: encodedSessionToken,
        // For managed install, we need to specify the app type
        isOnline: false,
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
        console.error('Token exchange result details:', {
          hasAccessToken: !!tokenExchangeResult.accessToken,
          hasScope: !!tokenExchangeResult.scope,
          scope: tokenExchangeResult.scope,
          expires: tokenExchangeResult.expires,
          associatedUser: tokenExchangeResult.associatedUser,
          accountOwner: tokenExchangeResult.accountOwner
        });
              console.error('This might be due to:');
      console.error('1. App not configured for Managed Install in Partner Dashboard');
      console.error('2. Incorrect scopes configuration');
      console.error('3. App URL not properly configured');
      console.error('4. App not properly installed in the store');
      console.error('');
      console.error('SOLUTION STEPS:');
      console.error('1. Go to Partner Dashboard > Your App > App Setup');
      console.error('2. Set App URL to:', HOST_NAME || HOST);
      console.error('3. Add callback URL:', `${HOST_NAME || HOST}/auth/callback`);
      console.error('4. Ensure all required scopes are added:', requiredScopes);
      console.error('5. Reinstall the app in your store');
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
      console.log('Session stored with ID:', sessionId);
      console.log('Session details:', {
        id: session.id,
        shop: session.shop,
        hasAccessToken: !!session.accessToken,
        scope: session.scope
      });
      
      // Verify session was stored correctly
      const storedSession = await memorySessionStorage.loadSession(sessionId);
      console.log('Stored session verification:', {
        found: !!storedSession,
        hasAccessToken: !!storedSession?.accessToken,
        accessTokenLength: storedSession?.accessToken?.length
      });
      
    } catch (error) {
      console.error('Token exchange failed:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack
      });
      ctx.status = 500;
      ctx.body = 'Token exchange failed';
      return;
    }
  }
  
  ctx.state.shop = shop;
  ctx.state.session = session;
  
  const duration = Date.now() - start;
  console.log('Session set in ctx.state:', {
    shop: ctx.state.shop,
    sessionId: ctx.state.session?.id,
    hasAccessToken: !!ctx.state.session?.accessToken,
    duration: `${duration}ms`
  });
  
  await next();
}

// Billing check middleware - UPDATED FOR MANAGED PRICING
async function requiresSubscription(ctx, next) {
  try {
    // Check if session exists and has access token
    if (!ctx.state.session) {
      console.error('No session found in ctx.state');
      ctx.status = 500;
      ctx.body = 'Session not found';
      return;
    }
    
    if (!ctx.state.session.accessToken || ctx.state.session.accessToken === 'placeholder') {
      console.error('Session missing access token:', {
        sessionId: ctx.state.session.id,
        hasAccessToken: !!ctx.state.session.accessToken,
        accessToken: ctx.state.session.accessToken,
        accessTokenLength: ctx.state.session.accessToken?.length
      });
      ctx.status = 500;
      ctx.body = 'Session missing access token';
      return;
    }
    
    // Additional check for valid access token format
    if (typeof ctx.state.session.accessToken !== 'string' || ctx.state.session.accessToken.length < 10) {
      console.error('Invalid access token format:', {
        sessionId: ctx.state.session.id,
        accessTokenType: typeof ctx.state.session.accessToken,
        accessTokenLength: ctx.state.session.accessToken?.length
      });
      ctx.status = 500;
      ctx.body = 'Invalid access token format';
      return;
    }
    
    console.log('Creating GraphQL client with session:', {
      sessionId: ctx.state.session.id,
      shop: ctx.state.session.shop,
      hasAccessToken: !!ctx.state.session.accessToken
    });
    
    let client;
    try {
      client = new shopify.clients.Graphql({
        session: ctx.state.session,
      });
      console.log('GraphQL client created successfully');
    } catch (error) {
      console.error('Failed to create GraphQL client:', error);
      ctx.status = 500;
      ctx.body = 'Failed to create GraphQL client';
      return;
    }
    
    console.log('Executing GraphQL query for subscription check...');
    let response;
    try {
      response = await client.query({
        data: `{
          currentAppInstallation {
            activeSubscriptions {
              id
              status
              name
              test
            }
          }
        }`
      });
      console.log('GraphQL query executed successfully');
    } catch (error) {
      console.error('GraphQL query failed:', error);
      console.error('Error details:', {
        message: error.message,
        statusCode: error.response?.statusCode,
        body: error.response?.body
      });
      ctx.status = 500;
      ctx.body = 'GraphQL query failed';
      return;
    }
    
    const subscriptions = response.body.data.currentAppInstallation.activeSubscriptions || [];
    console.log('Found subscriptions:', subscriptions.length);
    subscriptions.forEach(sub => {
      console.log('Subscription:', { id: sub.id, status: sub.status, name: sub.name, test: sub.test });
    });
    
    const hasActiveSubscription = subscriptions.some(sub => 
      sub.status === 'ACTIVE' || sub.status === 'PENDING'
    );
    
    console.log('Has active subscription:', hasActiveSubscription);
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
      
      // Use App Bridge for redirect if in iframe
      if (ctx.headers['sec-fetch-dest'] === 'iframe') {
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
              var AppBridge = window['app-bridge'];
              var actions = AppBridge.actions;
              var createApp = AppBridge.default;
              var app = createApp({
                apiKey: '${SHOPIFY_API_KEY}',
                host: '${ctx.query.host || ''}'
              });
              var redirect = actions.Redirect.create(app);
              redirect.dispatch(actions.Redirect.Action.REMOTE, '${planSelectionUrl}');
            </script>
          </body>
          </html>
        `;
      } else {
        // Standard redirect if not in iframe
        ctx.redirect(planSelectionUrl);
      }
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
            test
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

// Main app route - with subscription check
router.get('(/)', authenticateRequest, requiresSubscription, async (ctx) => {
  console.log('=== MAIN ROUTE ===');
  const shop = ctx.query.shop;
  const host = ctx.query.host;
  
  if (!shop) {
    ctx.body = "Missing shop parameter. Please install the app through Shopify.";
    ctx.status = 400;
    return;
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
      host: HOST,
      hostName: HOST_NAME
    },
    sessions: allSessions,
    totalSessions: allSessions.length,
    shopifyConfig: {
      apiKey: SHOPIFY_API_KEY ? 'SET' : 'NOT SET',
      apiSecretKey: SHOPIFY_API_SECRET ? 'SET' : 'NOT SET',
      scopes: SCOPES.split(','),
      hostName: HOST_NAME || HOST,
      isEmbeddedApp: true,
      useOnlineTokens: false
    }
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

// Installation check endpoint
router.get('/api/installation/check', async (ctx) => {
  const { shop } = ctx.query;
  
  if (!shop) {
    ctx.status = 400;
    ctx.body = { error: 'Missing shop parameter' };
    return;
  }
  
  try {
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    const offlineSession = sessions.find(s => !s.isOnline);
    
    ctx.body = {
      shop: shop,
      hasOfflineSession: !!offlineSession,
      hasAccessToken: !!offlineSession?.accessToken,
      sessionDetails: offlineSession ? {
        id: offlineSession.id,
        shop: offlineSession.shop,
        isOnline: offlineSession.isOnline,
        hasAccessToken: !!offlineSession.accessToken,
        scope: offlineSession.scope
      } : null,
      totalSessions: sessions.length,
      allSessions: sessions.map(s => ({
        id: s.id,
        shop: s.shop,
        isOnline: s.isOnline,
        hasAccessToken: !!s.accessToken
      }))
    };
  } catch (error) {
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', function() {
  console.log(`✓ Server listening on port ${PORT}`);
  console.log(`✓ Using Token Exchange authentication (Shopify managed install)`);
  console.log(`✓ App URL: ${HOST}`);
  console.log('✓ Server ready to handle requests');
}).on('error', (err) => {
  console.error('FATAL: Server failed to start:', err);
  process.exit(1);
});

// Add server timeout
server.timeout = 30000; // 30 seconds
server.keepAliveTimeout = 30000; // 30 seconds

// Add global error handler
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  console.error('Stack trace:', err.stack);
  // Don't exit immediately, let the server handle it
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit immediately, let the server handle it
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});