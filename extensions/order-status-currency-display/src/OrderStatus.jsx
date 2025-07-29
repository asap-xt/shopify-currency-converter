// extensions/order-status-currency-display/src/OrderStatus.jsx
import React from 'react';
import {
  reactExtension,
  Text,
  View,
  BlockStack
} from '@shopify/ui-extensions-react/customer-account';

export default reactExtension(
  'customer-account.order-status.block.render',
  () => <TestOrderStatus />,
);

function TestOrderStatus() {
  console.log('🚀 Order Status Extension loaded!');
  
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        <Text size="medium" emphasis="bold">
          🇧🇬 BGN/EUR Extension работи! 🇪🇺
        </Text>
        <Text>
          Ако виждаш това съобщение, extension-ът се зарежда правилно.
        </Text>
      </BlockStack>
    </View>
  );
}