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
    
    // Add order info if available
    if (order && order.name) {
      container.appendChild(
        root.createComponent(Text, { appearance: 'subdued' }, `Поръчка ${order.name}`)
      );
    }
    
    container.appendChild(root.createComponent(Divider));
    
    // Information message
    const infoBlock = root.createComponent(BlockStack, { spacing: 'tight' });
    
    infoBlock.appendChild(
      root.createComponent(Text, { size: 'small' }, 
        '💡 Валутният конвертор показва пълна функционалност на Thank You страницата.'
      )
    );
    
    infoBlock.appendChild(
      root.createComponent(Text, { size: 'small' }, 
        'Там можете да видите всички цени конвертирани в EUR.'
      )
    );
    
    container.appendChild(infoBlock);
    
    // Rate info
    if (show_rate_info) {
      container.appendChild(root.createComponent(Divider));
      
      const rateBlock = root.createComponent(BlockStack, { spacing: 'tight' });
      rateBlock.appendChild(
        root.createComponent(Text, { appearance: 'subdued', size: 'small' }, 
          `Валутен курс: 1 EUR = ${BGN_TO_EUR_RATE} BGN`
        )
      );
      rateBlock.appendChild(
        root.createComponent(Text, { size: 'small' }, 
          'Фиксиран курс според Българската народна банка'
        )
      );
      container.appendChild(rateBlock);
    }
    
    // Euro switch warning
    if (highlight_euro_switch) {
      container.appendChild(root.createComponent(Divider));
      
      const euroBlock = root.createComponent(BlockStack, { spacing: 'tight' });
      euroBlock.appendChild(
        root.createComponent(Text, { appearance: 'warning', size: 'small' }, 
          '⚠️ От 01.01.2026 г. България официално преминава към EUR'
        )
      );
      euroBlock.appendChild(
        root.createComponent(Text, { size: 'small' }, 
          'Всички цени ще бъдат автоматично конвертирани с официалния курс.'
        )
      );
      container.appendChild(euroBlock);
    }
    
    root.appendChild(container);
  }
);