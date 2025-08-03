// public/app.js
console.log('🔥 app.js се зарежда...');

import createApp from 'https://cdn.shopify.com/shopifycloud/app-bridge.js';
import { authenticatedFetch } from 'https://esm.sh/@shopify/app-bridge-utils@3.5.1';
import { Redirect } from 'https://cdn.shopify.com/shopifycloud/app-bridge/actions';

// Инициализация на App Bridge
console.log('🔥 Инициализирам App Bridge...');
const apiKey = document.querySelector('meta[name="shopify-api-key"]').content;
const shopOrigin = new URLSearchParams(window.location.search).get('shop');
console.log('🔥 apiKey:', apiKey ? 'SET' : 'MISSING');
console.log('🔥 shopOrigin:', shopOrigin);
const app = createApp({ apiKey, shopOrigin });

// Готов helper за API calls & redirect
console.log('🔥 Създавам helpers...');
const shopifyFetch = authenticatedFetch(app);
const shopifyRedirect = Redirect.create(app);
console.log('🔥 shopifyFetch:', typeof shopifyFetch);
console.log('🔥 shopifyRedirect:', typeof shopifyRedirect);

// Експортирайте ги глобално
console.log('🔥 Експортирам глобални функции...');
window.shopifyFetch = shopifyFetch;
window.shopifyRedirect = shopifyRedirect;
window.showTab = showTab;
window.startBilling = startBilling;
console.log('🔥 Глобални функции експортирани');

// UI функции
async function loadAppData() {
  console.log('🔥 loadAppData стартира');
  try {
    const res = await shopifyFetch(`/api/shop?shop=${shopOrigin}`);
    console.log('response', res);
    
    if (res.ok) {
      const data = await res.json();
      console.log('Shop data loaded:', data);
      document.getElementById('loading').style.display = 'none';
      document.getElementById('status-badge').style.display = 'inline-block';
      
      // Check billing status
      checkBillingStatus();
    } else if (res.status === 302 || res.redirected) {
      // Redirected due to no subscription
      showBillingPrompt();
    } else {
      throw new Error('Failed loading shop');
    }
  } catch (e) {
    console.error('Error loading app data:', e);
    document.getElementById('loading').innerText = 'Грешка при зареждане';
  }
}

async function checkBillingStatus() {
  console.log('checkBillingStatus');
  try {
    const res = await shopifyFetch(`/api/billing/status?shop=${shopOrigin}`);
    console.log('response', res);
    
    if (res.ok) {
      const data = await res.json();
      const billingStatus = data.hasActiveSubscription;
      console.log('Billing status:', billingStatus);
      
      if (!billingStatus) {
        showBillingPrompt();
      }
    }
  } catch (e) {
    console.error('Error checking billing:', e);
  }
}

function showBillingPrompt() {
  const billingPrompt = `
    <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 24px; margin-bottom: 24px; text-align: center;">
      <h3 style="margin: 0 0 16px 0; color: #856404;">🎁 Започнете 5-дневен безплатен пробен период</h3>
      <p style="margin: 0 0 20px 0; color: #856404;">
        След пробния период: $14.99/месец<br>
        Можете да отмените по всяко време
      </p>
      <button onclick="startBilling()" class="big-button" style="background: #ffc107; color: #212529;">
        Започни безплатен пробен период
      </button>
      <br><br>
      <a href="/api/billing/create?shop=${shopOrigin}" class="big-button" style="background: #28a745; color: white; text-decoration: none; display: inline-block; margin-top: 10px;">
        Директно стартиране на абонамент
      </a>
    </div>
  `;
  
  // Insert billing prompt before main content
  const container = document.querySelector('.container');
  const header = document.querySelector('.header');
  header.insertAdjacentHTML('afterend', billingPrompt);
  
  // Hide main functionality
  document.querySelector('.quick-action').style.opacity = '0.5';
  document.querySelector('.quick-action').style.pointerEvents = 'none';
}

async function startBilling() {
  try {
    const res = await shopifyFetch(`/api/billing/create?shop=${shopOrigin}`);
    const { confirmationUrl } = await res.json();
    shopifyRedirect.dispatch(Redirect.Action.APP, confirmationUrl);
  } catch (e) {
    console.error('Billing error:', e);
    alert('Грешка при стартиране на пробен период. Моля опитайте отново.');
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
function checkBillingUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('billing') === 'success') {
    alert('🎉 Успешно активирахте плана! Вече можете да използвате всички функции.');
  } else if (urlParams.get('billing') === 'declined') {
    alert('❌ Плащането беше отказано. Моля опитайте отново.');
  }
}

// Изчакайте DOM, преди да стартирате
console.log('🔥 Регистрирам DOMContentLoaded event listener...');
document.addEventListener('DOMContentLoaded', () => {
  console.log('🔥 DOMContentLoaded — стартирам loadAppData');
  checkBillingUrlParams();
  loadAppData();
});
console.log('🔥 app.js завършен');