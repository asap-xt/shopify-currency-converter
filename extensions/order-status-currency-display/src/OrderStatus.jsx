// extensions/order-status-currency-display/src/OrderStatus.jsx
import React from 'react';
import {
  reactExtension,
  BlockStack,
  InlineStack,
  Text,
  View,
  useOrder
} from '@shopify/ui-extensions-react/customer-account';

export default reactExtension(
  'customer-account.order-status.block.render',
  () => <App />
);

function App() {
  const order = useOrder();
  
  // Debug - да видим какво връща
  console.log('Order data:', order);
  
  if (!order) {
    return (
      <View padding="base" border="base" background="subdued">
        <Text>Зареждане на поръчка...</Text>
      </View>
    );
  }
  
  // Фиксиран курс
  const rate = 1.95583;
  const toEUR = (bgn) => (parseFloat(bgn) / rate).toFixed(2);
  
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        <Text size="medium" emphasis="bold">
          🇧🇬 Твоята поръчка 🇪🇺
        </Text>
        
        {/* Общо - първо да видим дали работи */}
        <InlineStack spacing="base">
          <Text emphasis="bold">Общо:</Text>
          <Text emphasis="bold">
            {order.totalPrice.amount} BGN / {toEUR(order.totalPrice.amount)} EUR
          </Text>
        </InlineStack>
        
        {/* Debug info */}
        <Text size="small" subdued>
          Order ID: {order.id || 'N/A'}
        </Text>
      </BlockStack>
    </View>
  );
}