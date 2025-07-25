// extensions/checkout-ui/src/OrderStatus.jsx
import {
  extension,
  Text,
  BlockStack,
  InlineStack,
  Divider,
} from '@shopify/ui-extensions/customer-account';

export default extension(
  'customer-account.order-status.block.render',
  (root, api) => {
    // EUR exchange rate
    const BGN_TO_EUR_RATE = 1.95583;
    
    // Helper function to convert BGN to EUR
    const convertToEur = (bgnAmount) => {
      if (!bgnAmount) return '0.00';
      return (parseFloat(bgnAmount) / BGN_TO_EUR_RATE).toFixed(2);
    };
    
    // Get order and settings
    const order = api.order;
    const settings = api.settings;
    const show_rate_info = settings.show_rate_info !== false;
    const highlight_euro_switch = settings.highlight_euro_switch !== false;
    
    // Create main container
    const container = root.createComponent(BlockStack, { 
      spacing: 'base', 
      border: 'base', 
      cornerRadius: 'base', 
      padding: 'base' 
    });
    
    // Title
    const titleStack = root.createComponent(InlineStack, { 
      blockAlignment: 'center', 
      spacing: 'tight' 
    });
    titleStack.appendChild(
      root.createComponent(Text, { size: 'medium', emphasis: 'bold' }, '🇪🇺 EuroZone Currency Display')
    );
    container.appendChild(titleStack);
    
    // Loading state
    const statusText = root.createComponent(Text, {}, 'Зареждане на цените...');
    container.appendChild(statusText);
    
    root.appendChild(container);
    
    // Check if we have order
    if (!order || !order.id) {
      statusText.updateProps({ 
        children: 'Няма данни за поръчката',
        appearance: 'critical'
      });
      return;
    }
    
    // Extract order ID
    const orderId = order.id.split('/').pop();
    
    // Try to get shop domain
    let shopDomain = '';
    
    // Method 1: From window location
    if (typeof window !== 'undefined' && window.location) {
      const hostname = window.location.hostname;
      if (hostname.includes('.myshopify.com')) {
        shopDomain = hostname;
      } else if (hostname.includes('shopify.com')) {
        // Try to extract from URL path
        const pathMatch = window.location.pathname.match(/shops\/([^\/]+)/);
        if (pathMatch) {
          shopDomain = pathMatch[1] + '.myshopify.com';
        }
      } else {
        shopDomain = hostname;
      }
    }
    
    // Method 2: From order confirmation number pattern
    if (!shopDomain && order.name) {
      // Order names often contain shop identifier
      console.log('Order name:', order.name);
    }
    
    if (!shopDomain) {
      statusText.updateProps({ 
        children: 'Не можем да определим магазина. Моля вижте Thank You страницата за пълна функционалност.',
        appearance: 'warning'
      });
      
      // Add rate info
      if (show_rate_info) {
        container.appendChild(root.createComponent(Divider));
        container.appendChild(
          root.createComponent(Text, { appearance: 'subdued', size: 'small' }, 
            `Курс: 1 EUR = ${BGN_TO_EUR_RATE} BGN`
          )
        );
      }
      return;
    }
    
    // Fetch order data
    const appUrl = 'https://shopify-currency-converter-production.up.railway.app';
    
    fetch(`${appUrl}/api/order/${orderId}?shop=${shopDomain}`)
      .then(res => {
        if (!res.ok) {
          return res.text().then(text => {
            throw new Error(`Server error: ${res.status} - ${text}`);
          });
        }
        return res.json();
      })
      .then(data => {
        // Clear loading text
        container.removeChild(statusText);
        
        // Add total
        const totalBGN = data.totalPrice || '0';
        const totalEUR = convertToEur(totalBGN);
        container.appendChild(
          root.createComponent(Text, { size: 'large', emphasis: 'bold' }, 
            `${totalBGN} ЛВ / ${totalEUR} EUR`
          )
        );
        
        container.appendChild(root.createComponent(Divider));
        
        // Items block
        const itemsBlock = root.createComponent(BlockStack, { spacing: 'tight' });
        itemsBlock.appendChild(
          root.createComponent(Text, { appearance: 'subdued' }, 'Разбивка:')
        );
        
        // Add line items
        if (data.lineItems && data.lineItems.length > 0) {
          data.lineItems.forEach(item => {
            const itemPriceEUR = convertToEur(item.price);
            itemsBlock.appendChild(
              root.createComponent(Text, {}, 
                `${item.quantity}× ${item.title} - ${item.price} ЛВ / ${itemPriceEUR} EUR`
              )
            );
          });
        }
        
        // Add shipping
        const shippingBGN = data.shippingPrice || '0';
        const shippingEUR = convertToEur(shippingBGN);
        itemsBlock.appendChild(
          root.createComponent(Text, {}, 
            `Доставка - ${parseFloat(shippingBGN) === 0 ? 'БЕЗПЛАТНА' : `${shippingBGN} ЛВ / ${shippingEUR} EUR`}`
          )
        );
        
        container.appendChild(itemsBlock);
        
        // Rate info
        if (show_rate_info) {
          container.appendChild(root.createComponent(Divider));
          container.appendChild(
            root.createComponent(Text, { appearance: 'subdued', size: 'small' }, 
              `Курс: 1 EUR = ${BGN_TO_EUR_RATE} BGN`
            )
          );
        }
        
        // Euro switch warning
        if (highlight_euro_switch) {
          container.appendChild(root.createComponent(Divider));
          container.appendChild(
            root.createComponent(Text, { appearance: 'warning', size: 'small' }, 
              '⚠️ От 01.01.2026 г. България преминава към EUR'
            )
          );
        }
        
        // Success status
        container.appendChild(
          root.createComponent(Text, { appearance: 'success', size: 'small' }, 
            `✅ Реална цена от поръчка ${data.name || order.name}`
          )
        );
      })
      .catch(err => {
        console.error('Failed to fetch order:', err);
        statusText.updateProps({ 
          children: `Грешка: ${err.message}`,
          appearance: 'critical'
        });
        
        // Add helpful message
        container.appendChild(root.createComponent(Divider));
        container.appendChild(
          root.createComponent(Text, { size: 'small' }, 
            '💡 Моля вижте Thank You страницата за пълна функционалност.'
          )
        );
        
        // Still show rate info
        if (show_rate_info) {
          container.appendChild(root.createComponent(Divider));
          container.appendChild(
            root.createComponent(Text, { appearance: 'subdued', size: 'small' }, 
              `Курс: 1 EUR = ${BGN_TO_EUR_RATE} BGN`
            )
          );
        }
      });
  }
);