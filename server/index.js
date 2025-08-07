// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import koaSession from 'koa-session';
import Router from 'koa-router';
import crypto from 'crypto';
import getRawBody from 'raw-body';
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
  HOST
} = process.env;

// Validation
if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SCOPES || !HOST) {
  console.error('FATAL: Missing required environment variables!');
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
  auth: {
    useOnlineTokens: false, // Changed to false for billing
  },
  billing: {
    // This is required for Shopify Billing API
    // It tells Shopify that this app uses billing
    required: false
  }
});

const app = new Koa();
app.keys = [SHOPIFY_API_SECRET];

// Raw body middleware for webhooks
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

// Subscription cache
let SUBSCRIPTION_CACHE = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper functions for Token Exchange
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
  const shop = ctx.query.shop || ctx.query['shopify-reload']?.match(/shop=([^&]+)/)?.[1];
  
  ctx.set('Content-Type', 'text/html');
  ctx.body = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="shopify-api-key" content="${SHOPIFY_API_KEY}" />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <script>
          document.addEventListener('DOMContentLoaded', async function() {
            console.log('Session token bounce page loaded');
            
            // Get the redirect URL from query params
            const params = new URLSearchParams(window.location.search);
            const redirectUrl = params.get('shopify-reload');
            
            if (redirectUrl) {
              // Try to get session token
              if (window.shopify?.idToken) {
                try {
                  const token = await window.shopify.idToken();
                  console.log('Got session token, redirecting...');
                  
                  // Add token to URL and redirect
                  const url = new URL(redirectUrl, window.location.origin);
                  url.searchParams.set('id_token', token);
                  window.location.href = url.toString();
                } catch (err) {
                  console.error('Failed to get token:', err);
                  window.location.href = redirectUrl;
                }
              } else {
                console.log('No App Bridge available, redirecting anyway...');
                window.location.href = redirectUrl;
              }
            } else {
              // No redirect URL, go to main app
              window.location.href = '/?shop=${shop || ''}';
            }
          });
        </script>
      </head>
      <body>
        <div style="text-align: center; padding: 50px; font-family: sans-serif;">
          <p>Loading...</p>
        </div>
      </body>
    </html>
  `;
});

// Authentication middleware using Token Exchange
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
    shop = queryShop;
  }

  const sessions = await memorySessionStorage.findSessionsByShop(shop);
  let session = sessions.find(s => !s.isOnline);

  if (!session || !session.accessToken || session.accessToken === 'placeholder') {
    console.log('No valid session with access token, performing token exchange...');

    try {
      const tokenExchangeResult = await shopify.auth.tokenExchange({
        shop: shop,
        sessionToken: encodedSessionToken,
      });

      console.log('Token exchange successful');
      
      const accessToken = tokenExchangeResult.accessToken || tokenExchangeResult.session?.accessToken;
      
      if (!accessToken) {
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
        accessToken: accessToken,
        scope: tokenExchangeResult.session?.scope || tokenExchangeResult.scope || SCOPES,
        expires: null // Offline tokens don't expire
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

// Billing API endpoints - with fallback to Managed Pricing
router.get('/api/billing/create', authenticateRequest, async (ctx) => {
  try {
    const shop = ctx.state.shop;
    const session = ctx.state.session;
    
    if (!session?.accessToken) {
      ctx.status = 401;
      ctx.body = { error: 'No access token' };
      return;
    }

    console.log('=== CREATING BILLING SUBSCRIPTION ===');
    console.log('Shop:', shop);
    console.log('Has access token:', !!session.accessToken);

    // First try Billing API
    const mutation = `
      mutation CreateSubscription($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!) {
        appSubscriptionCreate(
          name: $name,
          returnUrl: $returnUrl,
          lineItems: $lineItems
        ) {
          userErrors {
            field
            message
          }
          confirmationUrl
          appSubscription {
            id
            status
          }
        }
      }
    `;

    const variables = {
      name: "BGN/EUR Price Display",
      returnUrl: `${HOST}/api/billing/callback?shop=${shop}`,
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: {
              amount: 14.99,
              currencyCode: "USD"
            },
            interval: "EVERY_30_DAYS"
          }
        }
      }]
    };

    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': session.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: mutation,
        variables: variables
      })
    });

    const result = await response.json();
    console.log('Billing create response:', JSON.stringify(result, null, 2));

    // Check if it's a Managed Pricing error
    const errors = result.data?.appSubscriptionCreate?.userErrors || [];
    const isManagedPricingError = errors.some(e => 
      e.message?.includes('Managed Pricing Apps cannot use the Billing API')
    );

    if (isManagedPricingError) {
      console.log('App is configured as Managed Pricing, using fallback...');
      
      // Fallback to Managed Pricing approach
      const appHandle = process.env.SHOPIFY_APP_HANDLE || 'bgn-eur-price-display';
      const confirmationUrl = `https://admin.shopify.com/store/${shop.replace('.myshopify.com', '')}/charges/${appHandle}/pricing_plans`;
      
      console.log('Managed Pricing URL:', confirmationUrl);
      ctx.body = { confirmationUrl };
      return;
    }

    if (errors.length > 0) {
      console.error('Billing create errors:', errors);
      ctx.status = 400;
      ctx.body = { 
        error: 'Failed to create subscription',
        details: errors
      };
      return;
    }

    const confirmationUrl = result.data?.appSubscriptionCreate?.confirmationUrl;
    if (!confirmationUrl) {
      ctx.status = 500;
      ctx.body = { error: 'No confirmation URL received' };
      return;
    }

    console.log('Confirmation URL:', confirmationUrl);
    ctx.body = { confirmationUrl };

  } catch (error) {
    console.error('Error creating billing subscription:', error);
    ctx.status = 500;
    ctx.body = { error: 'Internal server error', message: error.message };
  }
});

// Billing callback
router.get('/api/billing/callback', async (ctx) => {
  try {
    const { shop, charge_id } = ctx.query;
    
    console.log('=== BILLING CALLBACK ===');
    console.log('Shop:', shop);
    console.log('Charge ID:', charge_id);
    
    // Clear cache to force new check
    delete SUBSCRIPTION_CACHE[shop];
    
    // Redirect back to app with success message
    ctx.redirect(`/?shop=${shop}&billing=success`);
  } catch (error) {
    console.error('Billing callback error:', error);
    ctx.redirect(`/?shop=${ctx.query.shop}&billing=error`);
  }
});

// Check billing status
router.get('/api/billing/status', authenticateRequest, async (ctx) => {
  const shop = ctx.state.shop;
  const session = ctx.state.session;

  if (!shop || !session?.accessToken) {
    ctx.status = 400;
    ctx.body = { error: 'Missing shop or access token' };
    return;
  }

  console.log('=== CHECKING BILLING STATUS ===');
  console.log('Shop:', shop);
  
  // Check cache
  const cached = SUBSCRIPTION_CACHE[shop];
  if (cached && cached.timestamp > Date.now() - CACHE_DURATION) {
    console.log('Returning cached billing status');
    ctx.body = cached.data;
    return;
  }
  
  try {
    // Query active subscriptions
    const query = `{
      currentAppInstallation {
        activeSubscriptions {
          id
          status
          name
          test
          trialDays
          createdAt
          currentPeriodEnd
        }
      }
    }`;

    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': session.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    });

    const result = await response.json();
    console.log('Billing status response:', JSON.stringify(result, null, 2));

    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      ctx.body = {
        hasActiveSubscription: false,
        shop: shop,
        error: 'GraphQL query error',
        message: result.errors[0]?.message
      };
      return;
    }

    const subscriptions = result.data?.currentAppInstallation?.activeSubscriptions || [];
    
    // Filter only active subscriptions (no test filtering needed in production)
    const activeSubscriptions = subscriptions.filter(sub => sub.status === 'ACTIVE');
    
    const hasActiveSubscription = activeSubscriptions.length > 0;

    const responseData = {
      hasActiveSubscription: hasActiveSubscription,
      shop: shop,
      subscriptions: subscriptions,
      activeCount: activeSubscriptions.length,
      message: 'Real-time billing check from Shopify API'
    };

    // Cache the result
    SUBSCRIPTION_CACHE[shop] = {
      timestamp: Date.now(),
      data: responseData
    };

    ctx.body = responseData;
  } catch (error) {
    console.error('Error checking billing status:', error);
    ctx.body = {
      hasActiveSubscription: false,
      shop: shop,
      error: error.message,
      message: 'Error checking billing - defaulting to false'
    };
  }
});

// Cancel subscription
router.post('/api/billing/cancel', authenticateRequest, async (ctx) => {
  try {
    const shop = ctx.state.shop;
    const session = ctx.state.session;
    const { subscriptionId } = ctx.request.body;

    const mutation = `
      mutation CancelSubscription($id: ID!) {
        appSubscriptionCancel(id: $id) {
          userErrors {
            field
            message
          }
          appSubscription {
            id
            status
          }
        }
      }
    `;

    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': session.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: mutation,
        variables: { id: subscriptionId }
      })
    });

    const result = await response.json();
    
    if (result.data?.appSubscriptionCancel?.userErrors?.length > 0) {
      ctx.status = 400;
      ctx.body = { 
        error: 'Failed to cancel subscription',
        details: result.data.appSubscriptionCancel.userErrors
      };
      return;
    }

    // Clear cache
    delete SUBSCRIPTION_CACHE[shop];

    ctx.body = { success: true, subscription: result.data?.appSubscriptionCancel?.appSubscription };
  } catch (error) {
    console.error('Error canceling subscription:', error);
    ctx.status = 500;
    ctx.body = { error: 'Internal server error' };
  }
});

// OAuth routes for initial installation (handled by Shopify)
router.get('/auth', async (ctx) => {
  const shop = ctx.query.shop;
  if (!shop) {
    ctx.status = 400;
    ctx.body = 'Missing shop parameter';
    return;
  }

  console.log('=== OAUTH ROUTE HIT ===');
  console.log('Shop:', shop);
  
  // For embedded apps, Shopify handles the initial OAuth flow
  // Just redirect to the app
  ctx.redirect(`/?shop=${shop}&host=${ctx.query.host}`);
});

router.get('/auth/callback', async (ctx) => {
  try {
    console.log('=== OAUTH CALLBACK ===');
    
    // For embedded apps with Token Exchange, 
    // Shopify handles the OAuth flow automatically
    // This callback is mainly for redirect URLs
    
    const { shop, host } = ctx.query;
    
    // Redirect to main app page
    const redirectUrl = `/?shop=${shop}&host=${host}`;
    console.log('Redirecting to:', redirectUrl);
    
    ctx.redirect(redirectUrl);
  } catch (error) {
    console.error('OAuth callback error:', error);
    ctx.status = 500;
    ctx.body = 'Error during OAuth callback';
  }
});

// Debug billing configuration - enhanced
router.get('/api/billing/debug', authenticateRequest, async (ctx) => {
  try {
    const shop = ctx.state.shop;
    const session = ctx.state.session;
    
    // Check current app installation and capabilities
    const query = `{
      currentAppInstallation {
        id
        app {
          id
          title
          handle
          developerName
          pricingDetails
          pricingDetailsSummary
          requestedAccessScopes {
            handle
          }
        }
        activeSubscriptions {
          id
          status
          name
          test
          lineItems {
            id
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  price {
                    amount
                    currencyCode
                  }
                  interval
                }
              }
            }
          }
        }
        allSubscriptions(first: 5) {
          edges {
            node {
              id
              status
              name
              test
              createdAt
            }
          }
        }
      }
    }`;

    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': session.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    });

    const result = await response.json();
    
    // Also check what Shopify thinks about our app's capabilities
    const capabilitiesQuery = `{
      app {
        id
        title
        handle
        pricingDetails
        requestedAccessScopes {
          handle
        }
      }
    }`;
    
    const capResponse = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': session.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: capabilitiesQuery })
    });
    
    const capResult = await capResponse.json();
    
    ctx.body = {
      shop: shop,
      hasAccessToken: !!session.accessToken,
      sessionType: session.isOnline ? 'online' : 'offline',
      scopes: session.scope,
      configuredScopes: SCOPES,
      apiVersion: LATEST_API_VERSION,
      appInstallation: result.data?.currentAppInstallation,
      appCapabilities: capResult.data?.app,
      graphqlErrors: result.errors || capResult.errors,
      debugInfo: {
        nodeEnv: process.env.NODE_ENV,
        appHandle: process.env.SHOPIFY_APP_HANDLE,
        host: HOST
      }
    };
  } catch (error) {
    console.error('Debug error:', error);
    ctx.status = 500;
    ctx.body = { error: error.message };
  }
});

// Health check
router.get('/health', async (ctx) => {
  ctx.body = 'OK';
});

// Shop info
router.get('/api/shop', async (ctx) => {
  const shop = ctx.query.shop;

  if (!shop) {
    ctx.status = 400;
    ctx.body = { error: 'Missing shop parameter' };
    return;
  }

  ctx.body = {
    success: true,
    shop: {
      name: shop,
      domain: shop,
      email: 'admin@' + shop
    }
  };
});

// Test API endpoint
router.get('/api/test', authenticateRequest, async (ctx) => {
  ctx.body = {
    message: 'Success! Session is valid',
    shop: ctx.state.shop,
    hasAccessToken: !!ctx.state.session.accessToken,
    scope: ctx.state.session.scope
  };
});

// Mandatory compliance webhooks
router.post('/webhooks/customers/data_request', async (ctx) => {
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

// App uninstalled webhook
router.post('/webhooks/app/uninstalled', async (ctx) => {
  try {
    const hmacHeader = ctx.get('X-Shopify-Hmac-Sha256');
    const body = ctx.request.rawBody;

    const hash = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(body, 'utf8')
      .digest('base64');

    if (hash !== hmacHeader) {
      ctx.status = 401;
      ctx.body = 'Unauthorized';
      return;
    }

    const data = JSON.parse(body);
    const shop = data.shop_domain || data.shop;
    
    console.log('App uninstalled from shop:', shop);
    
    // Clear all data for this shop
    delete SUBSCRIPTION_CACHE[shop];
    
    // Delete sessions
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    for (const session of sessions) {
      await memorySessionStorage.deleteSession(session.id);
    }
    
    ctx.status = 200;
    ctx.body = { message: 'Uninstall webhook processed' };
  } catch (error) {
    console.error('Uninstall webhook error:', error);
    ctx.status = 500;
    ctx.body = 'Internal server error';
  }
});

// Main app route
router.get('(/)', async (ctx) => {
  console.log('=== MAIN ROUTE ===');
  const shop = ctx.query.shop;
  const host = ctx.query.host;

  if (!shop) {
    ctx.body = "Missing shop parameter. Please install the app through Shopify.";
    ctx.status = 400;
    return;
  }

  // For embedded apps, we should not check for session here
  // Let the frontend handle authentication via App Bridge
  
  const { billing } = ctx.query;
  if (billing === 'success') {
    console.log('Billing success callback received');
    delete SUBSCRIPTION_CACHE[shop];
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
      border: none;
      cursor: pointer;
    }
    .big-button:hover {
      background: #000;
      transform: translateY(-1px);
    }
    .big-button.warning {
      background: #ffc107;
      color: #212529;
    }
    .big-button.warning:hover {
      background: #e0a800;
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
    .warning {
      background: #f9fafb;
      border: 1px solid #e1e3e5;
      border-radius: 6px;
      padding: 20px;
      margin: 24px 0;
      line-height: 1.6;
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
    .billing-prompt {
      background: #fff3cd;
      border: 2px solid #ffc107;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
      text-align: center;
    }
    .billing-prompt h3 {
      margin: 0 0 16px 0;
      color: #856404;
    }
    .billing-prompt p {
      margin: 0 0 20px 0;
      color: #856404;
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

    <div id="billing-prompt" style="display: none;"></div>

    <div class="quick-action" id="quick-action">
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
              <p>След 01.01.2026 г. когато смените валутата на магазина на евро, приложението автоматично ще показва EUR като основна валута и BGN като референтна.</p>
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
    let sessionToken = null;
    
    // Get session token from different sources (async)
    async function getSessionToken() {
      // Try different methods to get session token
      if (window.shopify?.idToken) {
        try {
          const token = await window.shopify.idToken();
          return token;
        } catch (err) {
          console.error('Failed to get token from App Bridge:', err);
        }
      }
      
      // Check URL params
      const urlParams = new URLSearchParams(window.location.search);
      const tokenFromUrl = urlParams.get('id_token');
      if (tokenFromUrl) {
        return tokenFromUrl;
      }
      
      // Check if we have it in sessionStorage
      const storedToken = sessionStorage.getItem('shopify-id-token');
      if (storedToken) {
        return storedToken;
      }
      
      return null;
    }
    
    async function loadAppData() {
      console.log('loadAppData called');
      try {
        // First, ensure we have a session token
        if (!sessionToken) {
          sessionToken = await getSessionToken();
          if (!sessionToken) {
            console.error('No session token available for loadAppData');
            document.getElementById('loading').innerHTML = 'Грешка: Няма достъп';
            return;
          }
        }
        
        const url = '/api/shop?shop=${shop}';
        console.log('Fetching:', url);
        const response = await fetch(url);
        console.log('Response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('Shop data loaded:', data);
          document.getElementById('loading').style.display = 'none';
          document.getElementById('status-badge').style.display = 'inline-block';
          
          // ALWAYS check billing status for new installations
          checkBillingStatus();
        } else {
          console.error('Failed to load shop data');
          document.getElementById('loading').innerHTML = 'Грешка при зареждане';
        }
      } catch (error) {
        console.error('Error loading app data:', error);
        document.getElementById('loading').innerHTML = 'Грешка при зареждане';
      }
    }
    
    async function checkBillingStatus() {
      console.log('=== CHECK BILLING STATUS ===');
      try {
        sessionToken = await getSessionToken();
        
        if (!sessionToken) {
          console.error('No session token available');
          // Try to reload the page to get a fresh token
          setTimeout(() => {
            window.location.reload();
          }, 2000);
          return;
        }
        
        await checkBillingStatusWithToken();
      } catch (error) {
        console.error('Error checking billing:', error);
      }
    }
    
    async function checkBillingStatusWithToken() {
      const url = '/api/billing/status?shop=${shop}';
      console.log('Fetching billing status:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + sessionToken,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        billingStatus = data.hasActiveSubscription;
        console.log('Billing status:', billingStatus);
        console.log('Full response:', data);
        
        if (!billingStatus) {
          console.log('No active subscription - showing billing prompt');
          showBillingPrompt();
        } else {
          console.log('Active subscription found');
        }
      } else {
        console.error('Failed to check billing status');
      }
    }
    
    function showBillingPrompt() {
      console.log('Showing billing prompt');
      const billingPromptHtml = \`
        <div class="billing-prompt">
          <h3>🎁 Започнете 5-дневен безплатен пробен период</h3>
          <p>
            След пробния период: $14.99/месец<br>
            Можете да отмените по всяко време
          </p>
          <button onclick="startBilling()" class="big-button warning">
            Започни безплатен пробен период
          </button>
        </div>
      \`;
      
      document.getElementById('billing-prompt').innerHTML = billingPromptHtml;
      document.getElementById('billing-prompt').style.display = 'block';
      
      // Disable main functionality
      document.getElementById('quick-action').style.opacity = '0.5';
      document.getElementById('quick-action').style.pointerEvents = 'none';
    }
    
    async function startBilling() {
      try {
        if (!sessionToken) {
          sessionToken = await getSessionToken();
          if (!sessionToken) {
            alert('Грешка: Не може да се получи session token. Моля презаредете страницата.');
            return;
          }
        }
        
        console.log('Starting billing with token:', sessionToken.substring(0, 20) + '...');
        
        const response = await fetch('/api/billing/create?shop=${shop}', {
          headers: {
            'Authorization': 'Bearer ' + sessionToken,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          console.error('Billing create error:', errorData);
          alert('Грешка при стартиране на абонамент. Моля опитайте отново.');
          return;
        }
        
        const data = await response.json();
        console.log('Billing response:', data);
        
        if (data.confirmationUrl) {
          // Redirect to Shopify billing confirmation page
          window.top.location.href = data.confirmationUrl;
        } else {
          alert('Грешка при получаване на URL за потвърждение.');
        }
      } catch (error) {
        console.error('Billing error:', error);
        alert('Грешка при стартиране на абонамент: ' + error.message);
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
    const billing = urlParams.get('billing');
    
    if (billing === 'success') {
      alert('🎉 Успешно активирахте плана! Вече можете да използвате всички функции.');
      // Remove the parameter from URL
      const newUrl = new URL(window.location);
      newUrl.searchParams.delete('billing');
      window.history.replaceState({}, document.title, newUrl.toString());
    } else if (billing === 'error') {
      alert('❌ Възникна грешка при активиране на плана. Моля опитайте отново.');
    } else if (billing === 'needed') {
      // New installation - show billing prompt immediately
      console.log('New installation detected, will check billing status');
    }
    
    // Initialize App Bridge and load data
    document.addEventListener('DOMContentLoaded', async function() {
      console.log('DOM loaded, initializing...');
      
      // Wait a bit for App Bridge to initialize
      setTimeout(async () => {
        try {
          sessionToken = await getSessionToken();
          if (sessionToken) {
            console.log('Got session token');
            sessionStorage.setItem('shopify-id-token', sessionToken);
          }
          loadAppData();
        } catch (err) {
          console.error('Error getting initial token:', err);
          loadAppData();
        }
      }, 1000);
    });
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
      tokenLength: session.accessToken?.length
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
  console.log(`✓ Using Token Exchange authentication`);
  console.log(`✓ App URL: ${HOST}`);
  console.log(`✓ Billing API configured`);
}).on('error', (err) => {
  console.error('FATAL: Server failed to start:', err);
  process.exit(1);
});