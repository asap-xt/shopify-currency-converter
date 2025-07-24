// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import koaSession from 'koa-session'; // преименувах го, за да не се бърка с обекта от Shopify
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

// --- НАЧАЛО НА НАШЕТО РЕШЕНИЕ ---
// Създаваме собствен елементарен session storage, който имплементира нужния интерфейс.
// Това е 100% работеща алтернатива на проблемния MemorySessionStorage.
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
};
// --- КРАЙ НА НАШЕТО РЕШЕНИЕ ---

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

// Инициализация на Shopify API клиента
let Shopify;
try {
  console.log('Initializing Shopify API...');
  Shopify = shopifyApi({
    apiKey:         SHOPIFY_API_KEY,
    apiSecretKey:   SHOPIFY_API_SECRET,
    scopes:         SCOPES.split(','),
    hostName:       HOST_NAME,
    apiVersion:     LATEST_API_VERSION,
    isEmbeddedApp:  true,
    // Използваме нашата собствена имплементация:
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
      hostName: HOST_NAME
    }
  };
});

// OAuth start
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
    console.log('Calling Shopify.auth.beginAuth...');
    const redirectUrl = await Shopify.auth.beginAuth(
      ctx.req, ctx.res,
      shop,
      '/auth/callback',
      false // false за offline access token
    );
    console.log('Redirect URL generated:', redirectUrl);
    ctx.redirect(redirectUrl);
  } catch (error) {
    console.error('Error in beginAuth:', error);
    ctx.status = 500;
    ctx.body = 'Auth initialization failed: ' + error.message;
  }
});

// OAuth callback
router.get('/auth/callback', async (ctx) => {
    console.log('=== AUTH CALLBACK ===');
    console.log('Callback query:', ctx.query);
    
    try {
        console.log('Validating auth callback...');
        const session = await Shopify.auth.validateAuthCallback(
            ctx.req, ctx.res, ctx.query
        );
        console.log('Auth successful for shop:', session.shop);

        // Тук можеш да добавиш логиката за проверка на билинга, както беше преди.
        // За простота, сега просто ще пренасочим.
        
        // Пренасочване към приложението
        const redirectUrl = `/?shop=${session.shop}&host=${ctx.query.host}`;
        console.log('Redirecting to:', redirectUrl);
        ctx.redirect(redirectUrl);
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
        const session = await Shopify.Utils.loadCurrentSession(ctx.req, ctx.res);
        if (session) {
            console.log('Session found:', session.shop);
            ctx.body = { message: 'Success!', session: { shop: session.shop, scope: session.scope } };
        } else {
            console.log('No session found');
            ctx.status = 401;
            ctx.body = 'Unauthorized';
        }
    } catch (error) {
        console.error('Error in API test:', error);
        ctx.status = 500;
        ctx.body = 'Internal error: ' + error.message;
    }
});

// Middleware за всички останали заявки, за да се покаже главната страница
router.get('(/)', async (ctx) => {
    console.log('=== MAIN ROUTE ===');
    const shop = ctx.query.shop;
    console.log('Shop parameter:', shop);

    try {
        // Проверка дали имаме активна сесия
        const sessionId = await Shopify.Session.getCurrentId({
            isOnline: false,
            rawRequest: ctx.req,
            rawResponse: ctx.res,
        });
        console.log('Session ID:', sessionId);

        if (!sessionId) {
            // Ако няма сесия, а има `shop` параметър, пращаме към auth
            if (shop) {
                console.log('No session, redirecting to auth');
                ctx.redirect(`/auth?shop=${shop}`);
            } else {
                console.log('No session and no shop parameter');
                ctx.body = "Missing shop parameter. Please install the app through Shopify.";
                ctx.status = 400;
            }
            return;
        }
        
        console.log('Session found, showing app interface');
        // Ако има сесия, показваме HTML
        ctx.set('Content-Type', 'text/html');
        ctx.body = `
            <!DOCTYPE html>
            <html>
            <head>
              <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
              <script>
                const app = AppBridge.createApp({
                  apiKey: '${SHOPIFY_API_KEY}',
                  host: new URL(location.href).searchParams.get("host"),
                });
              </script>
            </head>
            <body>
              <h1>App is running!</h1>
              <p>Shop: ${shop}</p>
              <p>Session ID: ${sessionId}</p>
              <p>Timestamp: ${new Date().toISOString()}</p>
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

const PORT = parseInt(process.env.PORT, 10) || 8081;

console.log(`Starting server on port ${PORT}...`);

app.listen(PORT, function() {
  console.log(`✓ Server listening on port ${PORT}`);
  console.log(`✓ App URL: https://shopify-currency-converter.railway.app`);
  console.log(`✓ Auth URL: https://shopify-currency-converter.railway.app/auth`);
  console.log(`✓ Debug URL: https://shopify-currency-converter.railway.app/debug`);
}).on('error', (err) => {
  console.error('FATAL: Server failed to start:', err);
  process.exit(1);
});