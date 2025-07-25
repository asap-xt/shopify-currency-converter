// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import koaSession from 'koa-session'; // преименувах го, за да не се бърка с обекта от Shopify
import Router from 'koa-router';
import getRawBody from 'raw-body';
import crypto from 'crypto';
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

// OAuth start - правилен начин за embedded apps
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
    // Добавяме state за сигурност
    const state = crypto.randomBytes(16).toString('hex');
    // Запазваме state в сесията
    ctx.session = ctx.session || {};
    ctx.session.state = state;
    ctx.session.shop = shop;
    
    const authUrl = `https://${shop}/admin/oauth/authorize?` + 
      `client_id=${SHOPIFY_API_KEY}&` +
      `scope=${SCOPES}&` +
      `redirect_uri=${encodeURIComponent(HOST + '/auth/callback')}&` +
      `state=${state}`;
    
    console.log('OAuth URL generated');
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
        
        // Exchange code за access token
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
        
        // Създаваме сесия - използваме директно Session класа
        const session = new Session({
            id: `${shop}-offline`,
            shop: shop,
            state: state,
            isOnline: false,
            accessToken: tokenData.access_token,
            scope: tokenData.scope,
        });
        
        // Записваме сесията
        await memorySessionStorage.storeSession(session);
        console.log('Session stored successfully');
        
        // Пренасочване към приложението
        const host = ctx.query.host || Buffer.from(`${shop}/admin`).toString('base64');
        const redirectUrl = `https://${shop}/admin/apps/${SHOPIFY_API_KEY}`;
        console.log('Redirecting to admin:', redirectUrl);
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
        const shop = ctx.query.shop;
        if (!shop) {
            ctx.status = 400;
            ctx.body = 'Missing shop parameter';
            return;
        }
        
        const sessionId = `${shop}-offline`;
        const session = await memorySessionStorage.loadSession(sessionId);
        
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

// NEW TEST ROUTES - Добавете тук

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
        
        const sessionId = `${shop}-offline`;
        const session = await memorySessionStorage.loadSession(sessionId);
        
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

// Тестване на Themes API
router.get('/api/themes', async (ctx) => {
    console.log('=== THEMES API TEST ===');
    try {
        const shop = ctx.query.shop;
        if (!shop) {
            ctx.status = 400;
            ctx.body = 'Missing shop parameter';
            return;
        }
        
        const sessionId = `${shop}-offline`;
        const session = await memorySessionStorage.loadSession(sessionId);
        
        if (!session || !session.accessToken) {
            ctx.status = 401;
            ctx.body = 'Unauthorized - No valid session';
            return;
        }
        
        console.log('Fetching themes for shop:', shop);
        const response = await fetch(`https://${shop}/admin/api/2024-01/themes.json`, {
            headers: { 
                'X-Shopify-Access-Token': session.accessToken,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
        }
        
        const themes = await response.json();
        console.log(`Found ${themes.themes?.length || 0} themes`);
        
        ctx.body = {
            success: true,
            shop: shop,
            themesCount: themes.themes?.length || 0,
            themes: themes.themes?.map(theme => ({
                id: theme.id,
                name: theme.name,
                role: theme.role,
                theme_store_id: theme.theme_store_id
            })) || []
        };
        
    } catch (error) {
        console.error('Error fetching themes:', error);
        ctx.status = 500;
        ctx.body = 'Failed to fetch themes: ' + error.message;
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
        
        const sessionId = `${shop}-offline`;
        const session = await memorySessionStorage.loadSession(sessionId);
        
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

// Comprehensive API Test - проверява какво работи
router.get('/api/test-all', async (ctx) => {
    console.log('=== COMPREHENSIVE API TEST ===');
    try {
        const shop = ctx.query.shop;
        if (!shop) {
            ctx.status = 400;
            ctx.body = 'Missing shop parameter';
            return;
        }
        
        const sessionId = `${shop}-offline`;
        const session = await memorySessionStorage.loadSession(sessionId);
        
        if (!session || !session.accessToken) {
            ctx.status = 401;
            ctx.body = 'Unauthorized - No valid session';
            return;
        }
        
        const results = {};
        
        // List of API endpoints to test
        const apiTests = [
            { name: 'shop', url: '/admin/api/2024-01/shop.json' },
            { name: 'themes', url: '/admin/api/2024-01/themes.json' },
            { name: 'orders_count', url: '/admin/api/2024-01/orders/count.json' },
            { name: 'products_count', url: '/admin/api/2024-01/products/count.json' },
            { name: 'products', url: '/admin/api/2024-01/products.json?limit=1' },
            { name: 'orders', url: '/admin/api/2024-01/orders.json?limit=1' },
            { name: 'locations', url: '/admin/api/2024-01/locations.json' },
            { name: 'webhooks', url: '/admin/api/2024-01/webhooks.json' },
            { name: 'scriptTags', url: '/admin/api/2024-01/script_tags.json' },
            { name: 'assets', url: '/admin/api/2024-01/themes/' + (await getMainThemeId(shop, session.accessToken)) + '/assets.json' },
        ];
        
        for (const test of apiTests) {
            try {
                if (test.name === 'assets' && !test.url.includes('undefined')) {
                    // Skip assets test if no theme ID
                    continue;
                }
                
                const response = await fetch(`https://${shop}${test.url}`, {
                    headers: { 
                        'X-Shopify-Access-Token': session.accessToken,
                        'Content-Type': 'application/json'
                    }
                });
                
                let responseData = null;
                const responseText = await response.text();
                
                if (response.ok && responseText) {
                    try {
                        responseData = JSON.parse(responseText);
                    } catch (e) {
                        responseData = responseText;
                    }
                }
                
                results[test.name] = {
                    status: response.status,
                    success: response.ok,
                    error: response.ok ? null : `${response.status} ${response.statusText}`,
                    hasData: !!responseData,
                    dataKeys: responseData && typeof responseData === 'object' ? Object.keys(responseData) : null,
                    sampleResponse: responseText.length > 200 ? responseText.substring(0, 200) + '...' : responseText
                };
                
                console.log(`API Test ${test.name}: ${response.status}`);
                
            } catch (error) {
                results[test.name] = {
                    success: false,
                    error: error.message
                };
            }
        }
        
        ctx.body = {
            shop: shop,
            sessionScope: session.scope,
            message: 'Comprehensive API test results',
            results: results,
            workingAPIs: Object.keys(results).filter(key => results[key].success),
            blockedAPIs: Object.keys(results).filter(key => !results[key].success)
        };
        
    } catch (error) {
        console.error('Error in comprehensive API test:', error);
        ctx.status = 500;
        ctx.body = 'Comprehensive test failed: ' + error.message;
    }
});

// Helper function to get main theme ID
async function getMainThemeId(shop, accessToken) {
    try {
        const response = await fetch(`https://${shop}/admin/api/2024-01/themes.json`, {
            headers: { 
                'X-Shopify-Access-Token': accessToken,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const themes = await response.json();
            const mainTheme = themes.themes?.find(theme => theme.role === 'main');
            return mainTheme?.id || 'undefined';
        }
        return 'undefined';
    } catch (error) {
        return 'undefined';
    }
}
router.get('/api/products', async (ctx) => {
    console.log('=== PRODUCTS API TEST ===');
    try {
        const shop = ctx.query.shop;
        if (!shop) {
            ctx.status = 400;
            ctx.body = 'Missing shop parameter';
            return;
        }
        
        const sessionId = `${shop}-offline`;
        const session = await memorySessionStorage.loadSession(sessionId);
        
        if (!session || !session.accessToken) {
            ctx.status = 401;
            ctx.body = 'Unauthorized - No valid session';
            return;
        }
        
        console.log('Fetching products for shop:', shop);
        const response = await fetch(`https://${shop}/admin/api/2024-01/products.json?limit=5`, {
            headers: { 
                'X-Shopify-Access-Token': session.accessToken,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
        }
        
        const products = await response.json();
        console.log(`Found ${products.products?.length || 0} products`);
        
        // Extract pricing info за currency conversion
        const productPricing = products.products?.map(product => ({
            id: product.id,
            title: product.title,
            vendor: product.vendor,
            variants: product.variants?.map(variant => ({
                id: variant.id,
                title: variant.title,
                price: variant.price,
                compare_at_price: variant.compare_at_price,
                sku: variant.sku
            }))
        })) || [];
        
        ctx.body = {
            success: true,
            shop: shop,
            productsCount: products.products?.length || 0,
            products: productPricing,
            message: 'Products API works - useful for currency conversion!'
        };
        
    } catch (error) {
        console.error('Error fetching products:', error);
        ctx.status = 500;
        ctx.body = 'Failed to fetch products: ' + error.message;
    }
});
router.get('/api/orders-graphql', async (ctx) => {
    console.log('=== GRAPHQL ORDERS TEST ===');
    try {
        const shop = ctx.query.shop;
        if (!shop) {
            ctx.status = 400;
            ctx.body = 'Missing shop parameter';
            return;
        }
        
        const sessionId = `${shop}-offline`;
        const session = await memorySessionStorage.loadSession(sessionId);
        
        if (!session || !session.accessToken) {
            ctx.status = 401;
            ctx.body = 'Unauthorized - No valid session';
            return;
        }
        
        // GraphQL query за orders без лични данни
        const query = `
        {
          orders(first: 10) {
            edges {
              node {
                id
                name
                createdAt
                updatedAt
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                currencyCode
                displayFinancialStatus
                displayFulfillmentStatus
                subtotalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalTaxSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }`;
        
        console.log('Fetching orders via GraphQL for shop:', shop);
        const response = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
            method: 'POST',
            headers: { 
                'X-Shopify-Access-Token': session.accessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query })
        });
        
        if (!response.ok) {
            throw new Error(`Shopify GraphQL API error: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('GraphQL orders retrieved successfully');
        
        if (result.errors) {
            ctx.body = {
                success: false,
                shop: shop,
                errors: result.errors
            };
        } else {
            const orders = result.data.orders.edges.map(edge => edge.node);
            ctx.body = {
                success: true,
                shop: shop,
                ordersCount: orders.length,
                orders: orders,
                message: 'Orders retrieved via GraphQL (no customer data)'
            };
        }
        
    } catch (error) {
        console.error('Error fetching orders via GraphQL:', error);
        ctx.status = 500;
        ctx.body = 'Failed to fetch orders via GraphQL: ' + error.message;
    }
});
router.get('/api/debug-token', async (ctx) => {
    console.log('=== TOKEN DEBUG ===');
    try {
        const shop = ctx.query.shop;
        if (!shop) {
            ctx.status = 400;
            ctx.body = 'Missing shop parameter';
            return;
        }
        
        const sessionId = `${shop}-offline`;
        const session = await memorySessionStorage.loadSession(sessionId);
        
        if (!session || !session.accessToken) {
            ctx.status = 401;
            ctx.body = 'Unauthorized - No valid session';
            return;
        }
        
        // Test various API endpoints to see what works
        const tests = {};
        
        // Test 1: Shop API (should work)
        try {
            const shopResponse = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
                headers: { 
                    'X-Shopify-Access-Token': session.accessToken,
                    'Content-Type': 'application/json'
                }
            });
            tests.shop = {
                status: shopResponse.status,
                success: shopResponse.ok,
                error: shopResponse.ok ? null : `${shopResponse.status} ${shopResponse.statusText}`
            };
        } catch (err) {
            tests.shop = { success: false, error: err.message };
        }
        
        // Test 2: Orders Count (lighter than full orders)
        try {
            const countResponse = await fetch(`https://${shop}/admin/api/2024-01/orders/count.json`, {
                headers: { 
                    'X-Shopify-Access-Token': session.accessToken,
                    'Content-Type': 'application/json'
                }
            });
            const countText = await countResponse.text();
            tests.ordersCount = {
                status: countResponse.status,
                success: countResponse.ok,
                data: countResponse.ok ? JSON.parse(countText) : null,
                error: countResponse.ok ? null : `${countResponse.status} ${countResponse.statusText}`,
                rawResponse: countText
            };
        } catch (err) {
            tests.ordersCount = { success: false, error: err.message };
        }
        
        // Test 3: Direct orders API with minimal params
        try {
            const ordersResponse = await fetch(`https://${shop}/admin/api/2024-01/orders.json?limit=1`, {
                headers: { 
                    'X-Shopify-Access-Token': session.accessToken,
                    'Content-Type': 'application/json'
                }
            });
            const ordersText = await ordersResponse.text();
            tests.orders = {
                status: ordersResponse.status,
                success: ordersResponse.ok,
                data: ordersResponse.ok ? JSON.parse(ordersText) : null,
                error: ordersResponse.ok ? null : `${ordersResponse.status} ${ordersResponse.statusText}`,
                rawResponse: ordersText.length > 500 ? ordersText.substring(0, 500) + '...' : ordersText
            };
        } catch (err) {
            tests.orders = { success: false, error: err.message };
        }
        
        ctx.body = {
            shop: shop,
            sessionScope: session.scope,
            requestedScopes: SCOPES,
            tokenPresent: !!session.accessToken,
            tests: tests
        };
        
    } catch (error) {
        console.error('Error in token debug:', error);
        ctx.status = 500;
        ctx.body = 'Debug failed: ' + error.message;
    }
});

// Debug auth route - ДОБАВЕН ТУК!
router.get('/debug-auth', async (ctx) => {
    ctx.body = {
        message: 'Auth debug info',
        env: {
            hasApiKey: !!process.env.SHOPIFY_API_KEY,
            hasSecret: !!process.env.SHOPIFY_API_SECRET,
            scopes: process.env.SCOPES,
            host: process.env.HOST,
            hostName: process.env.HOST_NAME
        },
        sessions: Array.from(memorySessionStorage.storage.keys())
    };
});

// Middleware за всички останали заявки, за да се покаже главната страница
router.get('(/)', async (ctx) => {
    console.log('=== MAIN ROUTE ===');
    const shop = ctx.query.shop;
    console.log('Shop parameter:', shop);

    try {
        if (!shop) {
            console.log('No shop parameter');
            ctx.body = "Missing shop parameter. Please install the app through Shopify.";
            ctx.status = 400;
            return;
        }

        // Проверка дали имаме активна сесия
        const sessionId = `${shop}-offline`;
        const session = await memorySessionStorage.loadSession(sessionId);
        console.log('Session check for:', sessionId, session ? 'FOUND' : 'NOT FOUND');

        if (!session || !session.accessToken) {
            // За embedded apps - просто redirect към auth
            console.log('No valid session, redirecting to auth');
            const authUrl = `/auth?shop=${shop}`;
            ctx.redirect(authUrl);
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
              <h1>🎉 Currency Converter App is running!</h1>
              <p><strong>Shop:</strong> ${shop}</p>
              <p><strong>Session ID:</strong> ${sessionId}</p>
              <p><strong>Access Token:</strong> ${session.accessToken ? '✅ Present' : '❌ Missing'}</p>
              <p><strong>Scopes:</strong> ${session.scope || SCOPES}</p>
              <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
              <hr>
              <h3>API Test Links:</h3>
              <ul>
                <li><a href="/api/test?shop=${shop}" target="_blank">Test API Session</a></li>
                <li><a href="/api/test-all?shop=${shop}" target="_blank">🔍 Test ALL APIs (Comprehensive)</a></li>
                <li><hr></li>
                <li><strong>Known Working APIs:</strong></li>
                <li><a href="/api/themes?shop=${shop}" target="_blank">🎨 Themes API ✅</a></li>
                <li><a href="/api/shop?shop=${shop}" target="_blank">🏪 Shop Info API ✅</a></li>
                <li><hr></li>
                <li><strong>Blocked APIs (Protected Customer Data):</strong></li>
                <li><a href="/api/orders?shop=${shop}" target="_blank">🛍️ Orders API ❌</a></li>
                <li><a href="/api/products?shop=${shop}" target="_blank">📦 Products API ❌</a></li>
                <li><hr></li>
                <li><a href="/api/debug-token?shop=${shop}" target="_blank">🔍 Debug Token Permissions</a></li>
                <li><a href="/debug" target="_blank">Debug Info</a></li>
                <li><a href="/health" target="_blank">Health Check</a></li>
              </ul>
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

// Използваме Railway's динамичен port
const PORT = process.env.PORT || 3000;

console.log(`Starting server on port ${PORT}...`);

// Bind към 0.0.0.0 за Railway compatibility
app.listen(PORT, '0.0.0.0', function() {
  console.log(`✓ Server listening on port ${PORT} (bound to 0.0.0.0)`);
  console.log(`✓ App URL: https://shopify-currency-converter-production.up.railway.app`);
  console.log(`✓ Auth URL: https://shopify-currency-converter-production.up.railway.app/auth`);
  console.log(`✓ Debug URL: https://shopify-currency-converter-production.up.railway.app/debug`);
  console.log(`✓ Health URL: https://shopify-currency-converter-production.up.railway.app/health`);
}).on('error', (err) => {
  console.error('FATAL: Server failed to start:', err);
  process.exit(1);
});