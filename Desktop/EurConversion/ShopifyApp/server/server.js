import express from 'express';
import { Shopify, ApiVersion } from '@shopify/shopify-api';
import { shopifyAuth } from '@shopify/koa-shopify-auth';
import koa from 'koa';
import mount from 'koa-mount';
import { verifyRequest } from '@shopify/koa-shopify-auth';

// Инициализация на Shopify API
Shopify.Context.initialize({
  API_KEY: process.env.SHOPIFY_API_KEY,
  API_SECRET_KEY: process.env.SHOPIFY_API_SECRET,
  SCOPES: process.env.SCOPES.split(','),
  HOST_NAME: process.env.HOST.replace(/https?:\/\//, ''),
  API_VERSION: ApiVersion.July25,
  IS_EMBEDDED_APP: true,
  SESSION_STORAGE: new Shopify.Session.MemorySessionStorage(),
});

const Koa = koa;
const app = new Koa();
const router = new express.Router();

app.use(
  shopifyAuth({
    async afterAuth(ctx) {
      const { shop, accessToken } = ctx.state.shopify;
      ctx.redirect('/');
    },
  })
);

// Mount express for any REST endpoints you might add
const expressApp = express();
expressApp.use(router);
app.use(mount('/', expressApp));

const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, () => {
  console.log(`> App listening on http://localhost:${PORT}`);
});
