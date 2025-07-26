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
  // Вземаме валутата
  const currency = useCurrency();
  
  // Вземаме адреса на доставка
  const shippingAddress = useShippingAddress();
  
  // Общата сума
  const total = useTotalAmount();
  
  // Продуктите в поръчката
  const lines = useCartLines();
  
  // ВРЕМЕННО - НЕ ПРАВИМ НИКАКВИ ПРОВЕРКИ
  // Просто показваме debug информация
  
  const orderCurrency = total?.currencyCode || currency;
  const countryCode = shippingAddress?.countryCode;
  
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
    console.log('Error:', error);
  }
  
  const totalBGN = total?.amount || 0;
  const totalEUR = convertToEUR(totalBGN);

  // ВИНАГИ показваме UI с debug информация
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        {/* DEBUG ИНФОРМАЦИЯ */}
        <View padding="tight" background="critical" cornerRadius="base">
          <BlockStack spacing="tight">
            <Text size="small" appearance="critical" emphasis="bold">
              🔍 DEBUG INFO:
            </Text>
            <Text size="small" appearance="critical">
              Currency from useCurrency(): {String(currency)}
            </Text>
            <Text size="small" appearance="critical">
              Currency from total: {String(total?.currencyCode)}
            </Text>
            <Text size="small" appearance="critical">
              Country: {String(countryCode)}
            </Text>
            <Text size="small" appearance="critical">
              Total amount: {String(total?.amount)}
            </Text>
          </BlockStack>
        </View>
        
        {/* Заглавие с флагове */}
        <Text size="medium" emphasis="bold">
          🚨 ТЕСТ ПРОМЯНА 🚨
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
            Курс: 1 EUR = {EUR_TO_BGN_RATE} BGN
          </Text>
        </View>
      </BlockStack>
    </View>
  );
}