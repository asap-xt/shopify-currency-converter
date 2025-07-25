// extensions/checkout-ui/src/OrderStatus.jsx
import {
  extension,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  Icon,
  Banner,
  Heading,
  Badge,
} from '@shopify/ui-extensions/customer-account';

export default extension(
  'customer-account.order-status.block.render',
  (root, api) => {
    const { i18n, extension } = api;
    
    // Get order data from the extension context
    const order = extension.target;
    
    // Exchange rate (same as in Checkout.jsx)
    const BGN_TO_EUR_RATE = 0.51129;
    
    // Helper function to convert BGN to EUR
    const convertToEUR = (bgnAmount) => {
      const numAmount = parseFloat(bgnAmount.replace(',', '.'));
      return (numAmount * BGN_TO_EUR_RATE).toFixed(2);
    };
    
    // Extract amounts from order if available
    let totalAmountBGN = null;
    let totalAmountEUR = null;
    
    try {
      // Try to get the total from order context
      if (order?.totalPrice?.amount) {
        totalAmountBGN = order.totalPrice.amount;
        totalAmountEUR = convertToEUR(totalAmountBGN);
      }
    } catch (error) {
      console.log('Could not access order data:', error);
    }
    
    // Create the UI
    root.appendChild(
      root.createComponent(BlockStack, { spacing: 'base' }, [
        // Header
        root.createComponent(
          InlineStack,
          { spacing: 'base', alignment: 'spaceBetween' },
          [
            root.createComponent(
              InlineStack,
              { spacing: 'tight' },
              [
                root.createComponent(Icon, { source: 'cash' }),
                root.createComponent(Heading, { level: 3 }, 'Валутен конвертор')
              ]
            ),
            root.createComponent(Badge, { status: 'info' }, 'BGN ⇄ EUR')
          ]
        ),
        
        root.createComponent(Divider),
        
        // If we have order data, show converted prices
        totalAmountBGN && totalAmountEUR ? 
          root.createComponent(BlockStack, { spacing: 'tight' }, [
            root.createComponent(Text, { emphasis: 'bold' }, 'Обща сума на поръчката:'),
            root.createComponent(
              InlineStack,
              { spacing: 'base' },
              [
                root.createComponent(Text, {}, `🇧🇬 ${totalAmountBGN} лв.`),
                root.createComponent(Text, { appearance: 'subdued' }, '='),
                root.createComponent(Text, {}, `🇪🇺 €${totalAmountEUR}`)
              ]
            )
          ]) :
          // Otherwise show informative block
          root.createComponent(
            Banner,
            { 
              status: 'info',
              title: 'Информация за валутния курс'
            },
            [
              root.createComponent(Text, {}, 
                'Цените в този магазин се показват в български лева (BGN) и евро (EUR).'
              )
            ]
          ),
        
        root.createComponent(Divider),
        
        // Exchange rate info
        root.createComponent(BlockStack, { spacing: 'tight' }, [
          root.createComponent(Text, { emphasis: 'bold', size: 'small' }, 
            'Текущ обменен курс:'
          ),
          root.createComponent(
            InlineStack,
            { spacing: 'loose' },
            [
              root.createComponent(
                BlockStack,
                { spacing: 'extraTight' },
                [
                  root.createComponent(Text, { size: 'small' }, '🇧🇬 1 BGN ='),
                  root.createComponent(Text, { emphasis: 'bold' }, '0.51129 EUR')
                ]
              ),
              root.createComponent(
                BlockStack,
                { spacing: 'extraTight' },
                [
                  root.createComponent(Text, { size: 'small' }, '🇪🇺 1 EUR ='),
                  root.createComponent(Text, { emphasis: 'bold' }, '1.95583 BGN')
                ]
              )
            ]
          )
        ]),
        
        // Footer note
        root.createComponent(Text, { 
          size: 'small', 
          appearance: 'subdued' 
        }, 
          'Курсът е фиксиран съгласно Българския валутен борд.'
        )
      ])
    );
  }
);