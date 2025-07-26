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
  // ПЪРВО - проверяваме дали изобщо се извиква
  console.log('=== EXTENSION LOADED ===');
  
  // Вземаме валутата
  const currency = useCurrency();
  
  // Вземаме адреса на доставка
  const shippingAddress = useShippingAddress();
  
  // Общата сума
  const total = useTotalAmount();
  
  // Продуктите в поръчката
  const lines = useCartLines();
  
  // Логваме ВЕДНАГА
  console.log('Currency from useCurrency():', currency);
  console.log('Total amount object:', total);
  console.log('Shipping address:', shippingAddress);
  
  // МНОГО ВАЖНО: Проверяваме дали данните са зареждани
  if (!total) {
    console.log('Total is not loaded yet');
    return <Text>Loading...</Text>;
  }
  
  // Вземаме валутата от различни места
  const orderCurrency = total.currencyCode || currency;
  const countryCode = shippingAddress?.countryCode;
  
  console.log('Final checks - Currency:', orderCurrency, 'Country:', countryCode);
  
// ВРЕМЕННО - показваме винаги, но с debug info
if (false) { // Временно деактивираме проверката
  console.log('HIDING: Currency is', orderCurrency, 'Country is', countryCode);
  return null;
}
  
  console.log('SHOWING: Conditions met - BGN currency and BG country');
  
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
  
  const totalBGN = total.amount || 0;
  const totalEUR = convertToEUR(totalBGN);

  // UI за BGN поръчки в България
  return (
  <View padding="base" border="base" background="subdued">
    <BlockStack spacing="base">
      <Text size="small" appearance="critical">
        DEBUG: Detected currency={orderCurrency || 'null'}, country={countryCode || 'null'}
      </Text>
        
        {/* Разбивка секция */}
        <View padding="base" background="base" cornerRadius="base">
          <BlockStack spacing="base">
            <Text size="small" emphasis="bold">
              Продукти:
            </Text>
            
            {/* Продукти по отделно */}
            {lines && lines.length > 0 && (
              <BlockStack spacing="tight">
                {lines.map((line, index) => {
                  const title =
                    line.merchandise.product?.title ?? 
                    line.merchandise.title ??
                    'Продукт';
                  const lineBGN = line.cost?.totalAmount?.amount || 0;
                  const lineEUR = convertToEUR(lineBGN);

                  return (
                    <InlineLayout
                      key={line.id || index}
                      spacing="base"
                      blockAlignment="center"
                    >
                      <View inlineAlignment="start" minInlineSize="fill">
                        <Text size="small">
                          {line.quantity}× {title}
                        </Text>
                      </View>
                      <View inlineAlignment="end">
                        <Text size="small" emphasis="bold">
                          {lineBGN.toFixed(2)} ЛВ / {lineEUR} EUR
                        </Text>
                      </View>
                    </InlineLayout>
                  );
                })}
              </BlockStack>
            )}

            {/* Доставка в BGN / EUR */}
            {shipping && shipping.amount > 0 && (
              <>
                <Divider />
                <InlineLayout spacing="base" blockAlignment="center">
                  <View inlineAlignment="start" minInlineSize="fill">
                    <Text size="small">Доставка</Text>
                  </View>
                  <View inlineAlignment="end">
                    <Text size="small" emphasis="bold">
                      {shipping.amount.toFixed(2)} ЛВ / {convertToEUR(shipping.amount)} EUR
                    </Text>
                  </View>
                </InlineLayout>
              </>
            )}
          </BlockStack>
        </View>
        
        {/* Обща сума */}
        <View padding="tight" background="interactive" cornerRadius="base">
          <InlineLayout spacing="base" blockAlignment="center">
            <View inlineAlignment="start" minInlineSize="fill">
              <Text size="medium" emphasis="bold">Общо:</Text>
            </View>
            <View inlineAlignment="end">
              <Text size="large" emphasis="bold">
                {totalBGN.toFixed(2)} ЛВ / {totalEUR} EUR
              </Text>
            </View>
          </InlineLayout>
        </View>
        
        {/* Курс */}
        <View padding="extraTight">
          <Text size="small" appearance="subdued">
            Курс: 1 EUR = {EUR_TO_BGN_RATE} BGN (фиксиран курс на БНБ)
          </Text>
        </View>
      </BlockStack>
    </View>
  );
}