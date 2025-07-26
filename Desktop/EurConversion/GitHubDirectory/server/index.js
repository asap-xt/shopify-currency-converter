// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import koaSession from 'koa-session';
import Router from 'koa-router';
import crypto from 'crypto';
import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';

// --- DEBUG: Environment check ---
console.log('=== Environment Variables Check ===');
console.log('SHOPIFY_API_KEY:', process.env.SHOPIFY_API_KEY ? 'SET' : 'MISSING');
console.log('SHOPIFY_API_SECRET:', process.env.SHOPIFY_API_SECRET ? 'SET' : 'MISSING');
console.log('SCOPES:', process.env.SCOPES);
console.log('HOST:', process.env.HOST);
console.log('HOST_NAME:', process.env.HOST_NAME);
console.log('PORT:', process.env.PORT);
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

// State storage за OAuth (заобикаляме cookie проблема)
const oauthStateStorage = new Map();

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

console.log('✓ All required environment variables are present');

// Initialize Shopify API (все още ни трябва за типове и utilities)
let shopify;
try {
  shopify = shopifyApi({
    apiKey: SHOPIFY_API_KEY,
    apiSecretKey: SHOPIFY_API_SECRET,
    scopes: SCOPES.split(','),
    hostName: HOST_NAME,
    apiVersion: LATEST_API_VERSION,
    isEmbeddedApp: true,
    sessionStorage: memorySessionStorage,
  });
  console.log('✓ Shopify API initialized');
} catch (error) {
  console.error('FATAL: Failed to initialize Shopify API:', error);
  process.exit(1);
}

const app = new Koa();
app.keys = [SHOPIFY_API_SECRET];

// Error handler
app.on('error', (err, ctx) => {
  console.error('App error:', err);
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

// Health check
router.get('/health', async (ctx) => {
  ctx.body = 'OK';
});

// Helper функция за HMAC валидация
function verifyHmac(query) {
  const { hmac, ...params } = query;
  if (!hmac) return false;
  
  const message = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
    
  const calculatedHmac = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');
    
  return calculatedHmac === hmac;
}

// OAuth start - CUSTOM IMPLEMENTATION
router.get('/auth', async (ctx) => {
  console.log('=== AUTH START ===');
  const shop = ctx.query.shop;
  const host = ctx.query.host;
  
  if (!shop) {
    ctx.throw(400, 'Missing shop parameter');
    return;
  }
  
  try {
    // Генерираме state и го запазваме (не в cookie!)
    const state = crypto.randomBytes(16).toString('hex');
    oauthStateStorage.set(state, { shop, host, timestamp: Date.now() });
    
    // Почистваме стари states (по-стари от 10 минути)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, value] of oauthStateStorage) {
      if (value.timestamp < tenMinutesAgo) {
        oauthStateStorage.delete(key);
      }
    }
    
    // Създаваме OAuth URL директно
    const redirectUri = `${HOST}/auth/callback`;
    const authUrl = `https://${shop}/admin/oauth/authorize?` +
      `client_id=${SHOPIFY_API_KEY}&` +
      `scope=${SCOPES}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${state}`;
    
    console.log('Generated auth URL with state:', state);
    
    // За embedded apps - директно отваряме в _top frame
    ctx.body = `
      <!DOCTYPE html>
      <html>
        <head>
          <script>
            window.top.location.href = '${authUrl}';
          </script>
        </head>
        <body>
          Redirecting to Shopify for authentication...
        </body>
      </html>
    `;
    ctx.set('Content-Type', 'text/html');
    
  } catch (error) {
    console.error('Error in auth:', error);
    ctx.status = 500;
    ctx.body = 'Auth initialization failed: ' + error.message;
  }
});

// OAuth callback - CUSTOM IMPLEMENTATION
router.get('/auth/callback', async (ctx) => {
  console.log('=== AUTH CALLBACK ===');
  console.log('Query params:', ctx.query);
  
  const { code, hmac, shop, state, timestamp, host } = ctx.query;
  
  if (!code || !shop || !state) {
    ctx.status = 400;
    ctx.body = 'Missing required OAuth parameters';
    return;
  }
  
  try {
    // Проверяваме HMAC
    if (!verifyHmac(ctx.query)) {
      throw new Error('Invalid HMAC');
    }
    
    // Проверяваме state
    const storedState = oauthStateStorage.get(state);
    if (!storedState || storedState.shop !== shop) {
      throw new Error('Invalid state parameter');
    }
    oauthStateStorage.delete(state); // използваме го само веднъж
    
    // Exchange code за access token
    console.log('Exchanging code for access token...');
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
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${tokenResponse.status} - ${errorText}`);
    }
    
    const tokenData = await tokenResponse.json();
    console.log('Token received successfully');
    
    // Създаваме Session обект
    const sessionId = `${shop}_offline`;
    const session = new Session({
      id: sessionId,
      shop: shop,
      state: state,
      isOnline: false,
      accessToken: tokenData.access_token,
      scope: tokenData.scope,
    });
    
    // Записваме сесията
    await memorySessionStorage.storeSession(session);
    console.log('Session stored successfully');
    
    // Redirect обратно към app с App Bridge
    const appHost = host || storedState.host;
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
              host: '${appHost}',
            });
            
            const redirect = Redirect.create(app);
            redirect.dispatch(Redirect.Action.APP, '/?shop=${shop}&host=${appHost}');
          </script>
        </head>
        <body>
          Authentication successful. Redirecting...
        </body>
      </html>
    `;
    ctx.set('Content-Type', 'text/html');
    
  } catch (error) {
    console.error("Auth callback failed:", error);
    ctx.status = 500;
    ctx.body = 'Authentication failed: ' + error.message;
  }
});

// API Test endpoint
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
    const session = sessions.find(s => !s.isOnline);
    
    if (session && session.accessToken) {
      console.log('Session found:', session.shop);
      ctx.body = { 
        message: 'Success! Session is valid', 
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

// Shop info endpoint
router.get('/api/shop', async (ctx) => {
  console.log('=== SHOP INFO API ===');
  const shop = ctx.query.shop;
  if (!shop) {
    ctx.status = 400;
    ctx.body = 'Missing shop parameter';
    return;
  }
  
  try {
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    const session = sessions.find(s => !s.isOnline);
    
    if (!session || !session.accessToken) {
      ctx.status = 401;
      ctx.body = 'Unauthorized - No valid session';
      return;
    }
    
    const response = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: { 
        'X-Shopify-Access-Token': session.accessToken,
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

// Debug endpoint
router.get('/debug', async (ctx) => {
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
    message: 'Debug info',
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      port: process.env.PORT,
      hasShopifyKey: !!SHOPIFY_API_KEY,
      scopes: SCOPES,
      hostName: HOST_NAME,
      host: HOST
    },
    sessions: allSessions,
    oauthStates: Array.from(oauthStateStorage.keys())
  };
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

  try {
    // Check for session
    const sessions = await memorySessionStorage.findSessionsByShop(shop);
    const session = sessions.find(s => !s.isOnline);
    
    if (!session || !session.accessToken) {
      console.log('No valid session, redirecting to auth');
      ctx.redirect(`/auth?shop=${shop}&host=${host}`);
      return;
    }
    
    // Show app interface
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
      <p>Successfully installed! <span class="success-badge">✓ Active</span></p>
    </div>

    <div class="card">
      <h2>✅ Installation Complete</h2>
      <p>Your app is now ready to use. The currency converter will appear on your Thank You page.</p>
      <p style="margin-top: 16px;">
        <strong>Next steps:</strong><br>
        1. Go to your Theme Customizer<br>
        2. Navigate to the Thank You page<br>
        3. Add the BGN↔EUR Currency Display block<br>
        4. Save your changes
      </p>
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

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', function() {
  console.log(`✓ Server listening on port ${PORT}`);
  console.log(`✓ App URL: ${HOST}`);
}).on('error', (err) => {
  console.error('FATAL: Server failed to start:', err);
  process.exit(1);
});