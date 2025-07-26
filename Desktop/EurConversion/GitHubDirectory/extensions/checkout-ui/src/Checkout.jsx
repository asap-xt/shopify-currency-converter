// extensions/checkout-ui/src/Checkout.jsx
import { 
  reactExtension,
  Text,
  View,
  BlockStack,
  InlineLayout,
  useTotalAmount,
  useCartLines,
  useApi,
  useSubscription,
  Divider,
  useShippingAddress,
  useCurrency
} from '@shopify/ui-extensions-react/checkout';

const EUR_TO_BGN_RATE = 1.95583;

// Функция за конвертиране BGN → EUR
const convertToEUR = (bgnAmount) => {
  return (parseFloat(bgnAmount) / EUR_TO_BGN_RATE).toFixed(2);
};

export default reactExtension(
  'purchase.thank-you.block.render',
  () => <Extension />,
);

function Extension() {
  // Вземаме валутата на поръчката
  const currency = useCurrency();
  
  // Вземаме адреса на доставка
  const shippingAddress = useShippingAddress();
  
  // Общата сума
  const total = useTotalAmount();
  
  // Продуктите в поръчката
  const lines = useCartLines();
  
  // Breakdown данни
  const api = useApi();
  let subtotal = null;
  let shipping = null;
  
  try {
    if (api.cost) {
      if (api.cost.subtotalAmount) {
        subtotal = useSubscription(api.cost.subtotalAmount);
      }
      if (api.cost.totalShippingAmount) {
        shipping = useSubscription(api.cost.totalShippingAmount);
      }
    }
  } catch (error) {
    console.log('Error accessing cost data:', error);
  }
  
  // ПОДРОБЕН DEBUG - да видим всички данни
  console.log('=== CURRENCY DEBUG ===');
  console.log('useCurrency():', currency);
  console.log('total object:', JSON.stringify(total, null, 2));
  console.log('total.currencyCode:', total?.currencyCode);
  console.log('shipping address:', JSON.stringify(shippingAddress, null, 2));
  
  // Проверяваме всички възможни места за валута
  const possibleCurrencies = {
    fromUseCurrency: currency,
    fromTotalCurrencyCode: total?.currencyCode,
    fromLineCurrency: lines?.[0]?.cost?.totalAmount?.currencyCode,
    fromSubtotalCurrency: subtotal?.currencyCode,
    fromShippingCurrency: shipping?.currencyCode
  };
  
  console.log('All possible currencies:', possibleCurrencies);
  
  // Временно показваме debug информация
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        <Text size="medium" emphasis="bold">
          🔍 DEBUG INFO
        </Text>
        
        <Text size="small">
          useCurrency: {String(currency)}
        </Text>
        
        <Text size="small">
          total.currencyCode: {String(total?.currencyCode)}
        </Text>
        
        <Text size="small">
          Country: {String(shippingAddress?.countryCode)}
        </Text>
        
        <Text size="small">
          Total amount: {String(total?.amount)}
        </Text>
        
        <Text size="small" appearance="critical">
          Check browser console for detailed debug info
        </Text>
      </BlockStack>
    </View>
  );
}