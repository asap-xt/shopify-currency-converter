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
  useSubscription
} from '@shopify/ui-extensions-react/checkout';

const EUR_TO_BGN_RATE = 1.95583;

// Функция за конвертиране BGN → EUR
const convertToEUR = (bgnAmount) => {
  return (parseFloat(bgnAmount) / EUR_TO_BGN_RATE).toFixed(2);
};

console.log('🚀 EXTENSION FILE LOADED!');

export default reactExtension(
  'purchase.thank-you.block.render',
  () => <Extension />,
);

function Extension() {
  console.log('🎯 EXTENSION RENDERING!');
  
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
    
    console.log('Data:', { 
      total, 
      subtotal, 
      shipping, 
      linesCount: lines?.length || 0 
    });
  } catch (error) {
    console.log('Error:', error);
  }
  
  const totalBGN = total?.amount || 0;
  const totalEUR = convertToEUR(totalBGN);

  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="tight">
        <Text size="medium" emphasis="bold">
          🇪🇺 EuroZone Currency Display
        </Text>
        
        {/* Главната сума в BGN / EUR */}
        <InlineLayout spacing="base" blockAlignment="center">
          <Text size="large" emphasis="bold">
            {totalBGN.toFixed(2)} ЛВ / {totalEUR} EUR
          </Text>
        </InlineLayout>
        
        {/* Breakdown секция */}
        <View padding="tight" background="base" cornerRadius="base">
          <BlockStack spacing="tight">
            <Text size="small" emphasis="bold" appearance="subdued">
              Разбивка:
            </Text>
            
            {/* Продукти по отделно */}
            {lines && lines.length > 0 && (
              <BlockStack spacing="extraTight">
                {lines.map((line, index) => {
                  const title =
                    line.merchandise.product?.title ?? 
                    line.merchandise.title;
                  const lineBGN = line.cost.totalAmount.amount;
                  const lineEUR = convertToEUR(lineBGN);

                  return (
                    <InlineLayout
                      key={line.id || index}
                      spacing="base"
                      blockAlignment="center"
                    >
                      <Text size="small">
                        {line.quantity}× {title}
                      </Text>
                      <Text size="small" emphasis="bold">
                        {lineBGN.toFixed(2)} ЛВ / {lineEUR} EUR
                      </Text>
                    </InlineLayout>
                  );
                })}
              </BlockStack>
            )}

            {/* Доставка в BGN / EUR */}
            {shipping && shipping.amount > 0 && (
              <InlineLayout spacing="base" blockAlignment="center">
                <Text size="small">Доставка</Text>
                <Text size="small" emphasis="bold">
                  {shipping.amount.toFixed(2)} ЛВ / {convertToEUR(shipping.amount)} EUR
                </Text>
              </InlineLayout>
            )}
          </BlockStack>
        </View>
        
        <Text size="small" appearance="subdued">
          Курс: 1 EUR = {EUR_TO_BGN_RATE} BGN
        </Text>
        
        <Text size="extraSmall" appearance="accent">
          {total?.amount ? '✅ Реална цена от поръчката' : '📝 Примерна цена'}
        </Text>
      </BlockStack>
    </View>
  );
}