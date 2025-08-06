// server/index.js
import 'dotenv/config';
import '@shopify/shopify-api/adapters/node';
import Koa from 'koa';
import Router from 'koa-router';
import koaSession from 'koa-session';
import { shopifyApi, LATEST_API_VERSION } from '@shopify/shopify-api';

const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES, HOST, PORT = 3000 } = process.env;

// 1) Конфигуриране на shopify-api
const shopify = shopifyApi({
  apiKey:        SHOPIFY_API_KEY,
  apiSecretKey:  SHOPIFY_API_SECRET,
  scopes:        SCOPES.split(','),
  hostName:      HOST.replace(/^https?:\/\//, ''),
  apiVersion:    LATEST_API_VERSION,
  isEmbeddedApp: true,
  auth: { useOnlineTokens: true },   // Token Exchange
});

const app = new Koa();
app.keys = [ SHOPIFY_API_SECRET ];
app.use(koaSession({ sameSite: 'none', secure: true }, app));

const router = new Router();

// 2) Започваме OAuth/Token Exchange
router.get('/auth', async (ctx) => {
  await shopify.auth.beginAuth(
    ctx.req, ctx.res, ctx.query.shop, '/auth/callback', false
  );
});
router.get('/auth/callback', async (ctx) => {
  const session = await shopify.auth.validateAuthCallback(
    ctx.req, ctx.res, ctx.query
  );
  // насочваме към billing процеса
  ctx.redirect(`/api/billing/create?shop=${session.shop}`);
});

// 3) Endpoint за създаване на AppSubscription
router.get('/api/billing/create', async (ctx) => {
  const session = await shopify.session.getCurrentSession(ctx.req, ctx.res);
  const client  = new shopify.clients.Graphql({ session });

  const mutation = `
    mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean!) {
      appSubscriptionCreate(
        name: $name,
        returnUrl: $returnUrl,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: 14.99, currencyCode: USD },
                interval: EVERY_30_DAYS
              }
            }
          }
        ],
        test: $test
      ) {
        confirmationUrl
        userErrors { field message }
      }
    }
  `;

  const variables = {
    name:      "Basic Plan",                                      // име на абонамента
    returnUrl: `${HOST}/api/billing/callback`,                   // къде да върне Shopify
    test:      process.env.NODE_ENV !== 'production',            // true в дев
  };

  const resp = await client.query({ data: { query: mutation, variables } });

  const errs = resp.body.data.appSubscriptionCreate.userErrors;
  if (errs.length) {
    ctx.throw(400, errs.map(e => e.message).join('; '));
  }

  // пренасочваме търговеца към Shopify за потвърждение
  ctx.redirect(resp.body.data.appSubscriptionCreate.confirmationUrl);
});

// 4) Callback след одобрение на абонамента
router.get('/api/billing/callback', async (ctx) => {
  const session = await shopify.session.getCurrentSession(ctx.req, ctx.res);
  const client  = new shopify.clients.Graphql({ session });

  // Shopify връща ?id=<subscriptionId>
  const subscriptionId = ctx.query.id;
  const query = `
    query getSubscription($id: ID!) {
      node(id: $id) {
        ... on AppSubscription {
          id
          status
          currentPeriodEnd
        }
      }
    }
  `;
  const { body } = await client.query({ data: { query, variables: { id: subscriptionId } } });
  const subscription = body.data.node;

  // TODO: запиши subscription (например в база данни):
  // await saveToDatabase({ shop: session.shop, subscription });

  // можеш да покажеш потвърждение или да редиректнеш
  ctx.redirect(`/?billing=success`);
});

app.use(router.routes());
app.use(router.allowedMethods());

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});