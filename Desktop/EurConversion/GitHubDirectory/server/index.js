// server/index.js - MINIMAL TEST VERSION
import Koa from 'koa';
import Router from 'koa-router';

console.log('=== STARTING MINIMAL SERVER TEST ===');
console.log('Environment variables:');
console.log('PORT:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);

const app = new Koa();
const router = new Router();

// Simple test route
router.get('/debug', async (ctx) => {
  console.log('Debug route accessed');
  ctx.body = {
    message: 'Server is working!',
    timestamp: new Date().toISOString(),
    port: process.env.PORT
  };
});

// Root route
router.get('/', async (ctx) => {
  console.log('Root route accessed');
  ctx.body = 'Minimal server is running!';
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 3000;

console.log(`Attempting to start server on port ${PORT}...`);

app.listen(PORT, () => {
  console.log(`✓ MINIMAL SERVER RUNNING ON PORT ${PORT}`);
}).on('error', (err) => {
  console.error('FATAL: Server failed to start:', err);
});