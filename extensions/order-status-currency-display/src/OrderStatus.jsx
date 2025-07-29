// extensions/order-status-currency-display/src/OrderStatus.jsx
import React from 'react';
import {
  reactExtension,
  Text,
  View,
  BlockStack,
  InlineLayout,
  useApi,
  Divider,
  useLocalizationCountry,
  useLocalizationMarket,
  useOrder,
  useTotalAmount,
  useOrderLineItems
} from '@shopify/ui-extensions-react/customer-account';

const EUR_TO_BGN_RATE = 1.95583;

// Функции за конвертиране - СЪЩИТЕ КАТО В Checkout.jsx
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
  const country = useLocalizationCountry();
  const market = useLocalizationMarket();
  
  // Използваме hooks за order данни
  const order = useOrder();
  const totalAmount = useTotalAmount();
  const lineItems = useOrderLineItems();
  
  // ПРОВЕРКА - показваме САМО за България
  const isBulgaria = country?.isoCode === 'BG' || 
                     market?.handle === 'bulgaria' || 
                     market?.handle === 'bg';
  
  if (!isBulgaria) {
    return null;
  }
  
  // Ако няма данни за поръчката
  if (!order || !totalAmount) {
    return null;
  }
  
  const currency = totalAmount.currencyCode || 'BGN';
  const isBGN = currency === 'BGN';
  const total = totalAmount.amount || 0;
  
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        {/* Заглавие с флагове - същото като в Checkout.jsx */}
        <Text size="medium" emphasis="bold">
          🇧🇬 Твоята поръчка 🇪🇺
        </Text>
        
        {/* Продукти ако имаме lineItems */}
        {lineItems && lineItems.length > 0 && (
          <View padding="base" background="base" cornerRadius="base">
            <BlockStack spacing="base">
              <Text size="small" emphasis="bold">
                Продукти:
              </Text>
              
              <BlockStack spacing="tight">
                {lineItems.map((item, index) => {
                  const lineAmount = item.totalAmount?.amount || 0;
                  
                  const displayPrice = isBGN
                    ? `${lineAmount.toFixed(2)} ЛВ / ${convertBGNtoEUR(lineAmount)} EUR`
                    : `${lineAmount.toFixed(2)} EUR / ${convertEURtoBGN(lineAmount)} ЛВ`;

                  return (
                    <InlineLayout
                      key={index}
                      spacing="base"
                      blockAlignment="center"
                    >
                      <View inlineAlignment="start" minInlineSize="fill">
                        <Text size="small">
                          {item.quantity}× {item.title || item.name}
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
            </BlockStack>
          </View>
        )}
        
        {/* Обща сума */}
        <View padding="tight" background="interactive" cornerRadius="base">
          <InlineLayout spacing="base" blockAlignment="center">
            <View inlineAlignment="start" minInlineSize="fill">
              <Text size="medium" emphasis="bold">Общо:</Text>
            </View>
            <View inlineAlignment="end">
              <Text size="large" emphasis="bold">
                {isBGN
                  ? `${total.toFixed(2)} ЛВ / ${convertBGNtoEUR(total)} EUR`
                  : `${total.toFixed(2)} EUR / ${convertEURtoBGN(total)} ЛВ`
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