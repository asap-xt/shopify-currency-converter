import Koa from 'koa';
import session from 'koa-session';
import Router from 'koa-router';
import createShopifyAuth, { verifyRequest } from '@shopify/koa-shopify-auth';
import { shopifyApi, LATEST_API_VERSION, BillingInterval } from '@shopify/shopify-api';
import dotenv from 'dotenv';

dotenv.config();
const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES, HOST } = process.env;

const app = new Koa();
app.keys = [SHOPIFY_API_SECRET];
app.use(session(app));

const shopify = shopifyApi({
  apiKey: SHOPIFY_API_KEY,
  apiSecretKey: SHOPIFY_API_SECRET,
  scopes: SCOPES.split(','),
  hostName: HOST.replace(/https?:\/\//, ''),
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});

app.use(
  createShopifyAuth({
    async afterAuth(ctx) {
      const { shop, accessToken } = ctx.state.shopify;
      ctx.cookies.set('shopOrigin', shop, { httpOnly: false });

      // GraphQL клиент
      const client = new shopify.clients.Graphql({ shop, accessToken });

      // Проверка за съществуващи активни абонаменти
      const existing = await client.query({
        data: {
          query: `
          {
            currentAppInstallation {
              activeSubscriptions {
                name
                status
              }
            }
          }
        `,
        },
      });
      const subs = existing.body.data.currentAppInstallation.activeSubscriptions;
      const hasActive = subs.some(
        (sub) => sub.name === 'Monthly Multicurrency' && sub.status === 'ACTIVE'
      );

      // Ако няма активен абонамент, създаваме нов с 5‑дневен trial
      if (!hasActive) {
        const response = await client.query({
          data: {
            query: `
            mutation AppSubscriptionCreate(
              $name: String!,
              $returnUrl: URL!,
              $trialDays: Int!,
              $price: MoneyInput!,
              $interval: BillingInterval!
            ) {
              appSubscriptionCreate(
                name: $name,
                returnUrl: $returnUrl,
                trialDays: $trialDays,
                lineItems: [{
                  plan: {
                    appRecurringPricingDetails: {
                      price: $price,
                      interval: $interval
                    }
                  }
                }]
              ) {
                confirmationUrl
                userErrors { field message }
              }
            }
          `,
            variables: {
              name: 'Monthly Multicurrency',
              returnUrl: `${HOST}/?billing=success`,
              trialDays: 5,
              price: { amount: 14.99, currencyCode: 'USD' },
              interval: BillingInterval.Every30Days,
            },
          },
        });

        const { confirmationUrl, userErrors } = response.body.data.appSubscriptionCreate;
        if (userErrors.length) {
          console.error('Billing user errors:', userErrors);
          ctx.throw(500, 'Billing API error');
        }
        ctx.redirect(confirmationUrl);
        return;
      }

      // Иначе – директно в приложението
      ctx.redirect('/');
    },
  })
);

const router = new Router();
router.get('/', verifyRequest(), async (ctx) => {
  ctx.body = `<!DOCTYPE html>
<html>
  <head>
    <script src="https://unpkg.com/@shopify/app-bridge@3.7.9"></script>
  </head>
  <body>
    <div id="app"></div>
    <script>
      const createApp = window['app-bridge'].default;
      window.app = createApp({
        apiKey: '${SHOPIFY_API_KEY}',
        shopOrigin: '${ctx.cookies.get('shopOrigin')}'
      });
    </script>
  </body>
</html>`;
});

app.use(router.routes()).use(router.allowedMethods());

const PORT = parseInt(process.env.PORT, 10) || 8081;
app.listen(PORT, () => console.log(\`> Server listening on ${PORT}\`));
