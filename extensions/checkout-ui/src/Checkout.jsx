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
  useLocalizationCountry,
  useLocalizationMarket
} from '@shopify/ui-extensions-react/checkout';

const EUR_TO_BGN_RATE = 1.95583;

// Функции за конвертиране
const convertBGNtoEUR = (bgnAmount) => {
  return (parseFloat(bgnAmount) / EUR_TO_BGN_RATE).toFixed(2);
};

const convertEURtoBGN = (eurAmount) => {
  return (parseFloat(eurAmount) * EUR_TO_BGN_RATE).toFixed(2);
};

export default reactExtension(
  'purchase.thank-you.block.render',
  () => <Extension />,
);

function Extension() {
  // Проверяваме market и country
  const country = useLocalizationCountry();
  const market = useLocalizationMarket();
  
  // Общата сума
  const total = useTotalAmount();
  
  // Продуктите в поръчката
  const lines = useCartLines();
  
  // ПРОВЕРКА - показваме САМО за България (BG country или bulgaria market)
  const isBulgaria = country?.isoCode === 'BG' || 
                     market?.handle === 'bulgaria' || 
                     market?.handle === 'bg';
  
  if (!isBulgaria) {
    return null; // Не показваме за други държави/markets
  }
  
  const currency = total?.currencyCode;
  
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
  
  // Определяме кой е основен и кой вторичен според валутата
  const isBGN = currency === 'BGN';
  const totalAmount = total?.amount || 0;

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
                    line.merchandise.title;
                  const lineAmount = line.cost.totalAmount.amount;
                  
                  const displayPrice = isBGN
                    ? `${lineAmount.toFixed(2)} ЛВ / ${convertBGNtoEUR(lineAmount)} EUR`
                    : `${lineAmount.toFixed(2)} EUR / ${convertEURtoBGN(lineAmount)} ЛВ`;

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
                          {displayPrice}
                        </Text>
                      </View>
                    </InlineLayout>
                  );
                })}
              </BlockStack>
            )}

            {/* Доставка */}
            {shipping && shipping.amount > 0 && (
              <>
                <Divider />
                <InlineLayout spacing="base" blockAlignment="center">
                  <View inlineAlignment="start" minInlineSize="fill">
                    <Text size="small">Доставка</Text>
                  </View>
                  <View inlineAlignment="end">
                    <Text size="small" emphasis="bold">
                      {isBGN
                        ? `${shipping.amount.toFixed(2)} ЛВ / ${convertBGNtoEUR(shipping.amount)} EUR`
                        : `${shipping.amount.toFixed(2)} EUR / ${convertEURtoBGN(shipping.amount)} ЛВ`
                      }
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
                {isBGN
                  ? `${totalAmount.toFixed(2)} ЛВ / ${convertBGNtoEUR(totalAmount)} EUR`
                  : `${totalAmount.toFixed(2)} EUR / ${convertEURtoBGN(totalAmount)} ЛВ`
                }
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