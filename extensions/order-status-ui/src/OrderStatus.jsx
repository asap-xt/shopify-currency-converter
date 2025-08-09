// extensions/order-status-ui/src/OrderStatus.jsx
import { 
  reactExtension,
  Text,
  View,
  BlockStack,
  InlineLayout,
  Divider,
  useOrder,
  useApi
} from '@shopify/ui-extensions-react/customer-account';

const EUR_TO_BGN_RATE = 1.95583;

// Функции за конвертиране
const convertBGNtoEUR = (bgnAmount) => {
  return (parseFloat(bgnAmount) / EUR_TO_BGN_RATE).toFixed(2);
};

const convertEURtoBGN = (eurAmount) => {
  return (parseFloat(eurAmount) * EUR_TO_BGN_RATE).toFixed(2);
};

export default reactExtension(
  'customer-account.order-status.block.render',
  () => <OrderStatusExtension />,
);

function OrderStatusExtension() {
  // Използваме hooks
  const order = useOrder();
  const api = useApi();
  
  if (!order) {
    return (
      <View padding="base" border="base" background="subdued">
        <Text>Няма данни за поръчката</Text>
      </View>
    );
  }
  
  // Извличаме данните
  const cost = api?.cost;
  const lines = api?.lines;
  const localization = api?.localization;
  const currency = localization?.currency?.current?.isoCode || 'BGN';
  const isBGN = currency === 'BGN';
  
  // Извличаме lines от current свойството
  let linesArray = [];
  if (lines?.current) {
    linesArray = lines.current;
  } else if (Array.isArray(lines)) {
    linesArray = lines;
  }
  
  // Ако има данни, показваме ги
  if (cost && linesArray.length > 0) {
    const totalAmount = cost.totalAmount?.current?.amount || 0;
    const shippingAmount = cost.totalShippingAmount?.current?.amount || 0;
    
    return (
      <View padding="base" border="base" background="subdued">
        <BlockStack spacing="base">
          <Text size="medium" emphasis="bold">
            🇧🇬 Твоята поръчка 🇪🇺
          </Text>
          
          <View padding="base" background="base" cornerRadius="base">
            <BlockStack spacing="base">
              <Text size="small" emphasis="bold">
                Продукти:
              </Text>
              
              <BlockStack spacing="tight">
                {linesArray.map((line, index) => {
                  const title = line?.merchandise?.title || line?.title || `Продукт ${index + 1}`;
                  const lineAmount = line?.cost?.totalAmount?.amount || 0;
                  const quantity = line?.quantity || 1;
                  
                  const displayPrice = isBGN
                    ? `${lineAmount.toFixed(2)} ЛВ / ${convertBGNtoEUR(lineAmount)} EUR`
                    : `${lineAmount.toFixed(2)} EUR / ${convertEURtoBGN(lineAmount)} ЛВ`;

                  return (
                    <InlineLayout
                      key={`line-${index}`}
                      spacing="base"
                      blockAlignment="center"
                    >
                      <View inlineAlignment="start" minInlineSize="fill">
                        <Text size="small">
                          {quantity}× {title}
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

              {shippingAmount > 0 && (
                <>
                  <Divider />
                  <InlineLayout spacing="base" blockAlignment="center">
                    <View inlineAlignment="start" minInlineSize="fill">
                      <Text size="small">Доставка</Text>
                    </View>
                    <View inlineAlignment="end">
                      <Text size="small" emphasis="bold">
                        {isBGN
                          ? `${shippingAmount.toFixed(2)} ЛВ / ${convertBGNtoEUR(shippingAmount)} EUR`
                          : `${shippingAmount.toFixed(2)} EUR / ${convertEURtoBGN(shippingAmount)} ЛВ`
                        }
                      </Text>
                    </View>
                  </InlineLayout>
                </>
              )}
            </BlockStack>
          </View>
          
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
          
          <View padding="extraTight">
            <Text size="small" appearance="subdued">
              Курс: 1 EUR = {EUR_TO_BGN_RATE} BGN (фиксиран курс на БНБ)
            </Text>
          </View>
        </BlockStack>
      </View>
    );
  }
  
  // Ако няма данни
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        <Text size="medium" emphasis="bold">
          🇧🇬 Твоята поръчка 🇪🇺
        </Text>
        <Text size="small">
          Поръчка: {order.name || order.id}
        </Text>
        <Text size="small" appearance="subdued">
          Моля, презаредете страницата ако не виждате данните
        </Text>
      </BlockStack>
    </View>
  );
}