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
  
  // DEBUG: Логваме какво получаваме
  console.log('Currency:', currency);
  console.log('Shipping Address:', shippingAddress);
  console.log('Country Code:', shippingAddress?.countryCode);
  
  // ПРОВЕРКА 1: Валутата трябва да е BGN
  // Понякога currency идва като обект със свойство currencyCode
  const currencyCode = typeof currency === 'string' ? currency : currency?.currencyCode;
  
  if (currencyCode !== 'BGN') {
    console.log('Currency is not BGN, hiding extension');
    return null;
  }
  
  // ПРОВЕРКА 2: Адресът трябва да е в България
  // Проверяваме и двата възможни начина за достъп до country code
  const countryCode = shippingAddress?.countryCode || shippingAddress?.country;
  
  if (!countryCode || countryCode !== 'BG') {
    console.log('Country is not BG, hiding extension');
    return null;
  }
  
  // Ако няма обща сума, не показваме нищо
  if (!total || !total.amount) {
    console.log('No total amount, hiding extension');
    return null;
  }
  
  const totalBGN = total.amount;
  const totalEUR = convertToEUR(totalBGN);

  // Нормалният UI за BGN поръчки в България
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        {/* Заглавие с флагове */}
        <Text size="medium" emphasis="bold">
          🇧🇬 Твоята поръчка 🇪🇺
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