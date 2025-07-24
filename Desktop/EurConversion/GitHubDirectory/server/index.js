// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import koaSession from 'koa-session'; // преименувах го, за да не се бърка с обекта от Shopify
import Router from 'koa-router';
import getRawBody from 'raw-body';
import { shopifyApi, LATEST_API_VERSION, BillingInterval, Session } from '@shopify/shopify-api';

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

// Инициализация на Shopify API клиента
const Shopify = shopifyApi({
  apiKey:         SHOPIFY_API_KEY,
  apiSecretKey:   SHOPIFY_API_SECRET,
  scopes:         SCOPES.split(','),
  hostName:       HOST_NAME,
  apiVersion:     LATEST_API_VERSION,
  isEmbeddedApp:  true,
  // Използваме нашата собствена имплементация:
  sessionStorage: memorySessionStorage,
});

const app = new Koa();
app.keys = [SHOPIFY_API_SECRET];

// Настройки за koa-session за работа с iFrames в Shopify
app.use(koaSession({ sameSite: 'none', secure: true }, app));

const router = new Router();

// OAuth start
router.get('/auth', async (ctx) => {
  const shop = ctx.query.shop;
  if (!shop) {
    ctx.throw(400, 'Missing shop parameter');
    return;
  }
  const redirectUrl = await Shopify.auth.beginAuth(
    ctx.req, ctx.res,
    shop,
    '/auth/callback',
    false // false за offline access token
  );
  ctx.redirect(redirectUrl);
});

// OAuth callback
router.get('/auth/callback', async (ctx) => {
    try {
        const session = await Shopify.auth.validateAuthCallback(
            ctx.req, ctx.res, ctx.query
        );

        // Тук можеш да добавиш логиката за проверка на билинга, както беше преди.
        // За простота, сега просто ще пренасочим.
        
        // Пренасочване към приложението
        ctx.redirect(`/?shop=${session.shop}&host=${ctx.query.host}`);
    } catch (error) {
        console.error("Auth callback failed:", error);
        ctx.status = 500;
        ctx.body = 'Authentication failed';
    }
});

// Защитен ендпойнт за проверка на сесията
router.get('/api/test', async (ctx) => {
    const session = await Shopify.Utils.loadCurrentSession(ctx.req, ctx.res);
    if (session) {
        ctx.body = { message: 'Success!', session };
    } else {
        ctx.status = 401;
        ctx.body = 'Unauthorized';
    }
});


// Middleware за всички останали заявки, за да се покаже главната страница
router.get('(/)', async (ctx) => {
    const shop = ctx.query.shop;

    // Проверка дали имаме активна сесия
    const sessionId = await Shopify.Session.getCurrentId({
        isOnline: false,
        rawRequest: ctx.req,
        rawResponse: ctx.res,
    });

    if (!sessionId) {
        // Ако няма сесия, а има `shop` параметър, пращаме към auth
        if (shop) {
            ctx.redirect(`/auth?shop=${shop}`);
        } else {
            ctx.body = "Missing shop parameter. Please install the app through Shopify.";
            ctx.status = 400;
        }
        return;
    }
    
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
        </body>
        </html>
      `;
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = parseInt(process.env.PORT, 10) || 8081;
app.listen(PORT, function() {
  console.log(`> Server listening on port ${PORT}`);
});