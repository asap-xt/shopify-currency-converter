// extensions/order-status-currency-display/src/OrderStatus.jsx
import React from 'react';
import {
  reactExtension,
  Text,
  View,
  BlockStack,
  InlineLayout,
  Divider,
  useLocalizationCountry,
  useLocalizationMarket,
  useOrder  // ВАЖНО - този hook дава достъп до order данните
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
  // 1. ПЪРВО извикваме ВСИЧКИ hooks на най-горно ниво
  const country = useLocalizationCountry();
  const market = useLocalizationMarket();
  const order = useOrder(); // Получаваме order обекта
  
  // 2. Проверяваме дали order е зареден (ПРЕДИ каквито и да е други проверки)
  if (!order) {
    return null; // Връщаме null докато чакаме данните
  }
  
  // 3. СЛЕД ТОВА правим проверка за България
  const isBulgaria = country?.isoCode === 'BG' || 
                     market?.handle === 'bulgaria' || 
                     market?.handle === 'bg';
  
  if (!isBulgaria) {
    return null;
  }
  
  // 4. Сега вече е сигурно че order не е undefined - извличаме данните
  const lineItems = order.lineItems || [];
  const shippingAmount = parseFloat(order.shippingPrice?.amount || 0);
  const totalAmount = parseFloat(order.totalPrice?.amount || 0);
  const currency = order.totalPrice?.currencyCode || 'BGN';
  const isBGN = currency === 'BGN';
  
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        {/* Заглавие с флагове - същото като в Checkout.jsx */}
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
            {lineItems.length > 0 && (
              <BlockStack spacing="tight">
                {lineItems.map((item, index) => {
                  const lineAmount = parseFloat(item.price?.amount || 0);
                  const quantity = item.quantity || 1;
                  
                  const displayPrice = isBGN
                    ? `${lineAmount.toFixed(2)} ЛВ / ${convertBGNtoEUR(lineAmount)} EUR`
                    : `${lineAmount.toFixed(2)} EUR / ${convertEURtoBGN(lineAmount)} ЛВ`;

                  return (
                    <InlineLayout
                      key={item.id || index}
                      spacing="base"
                      blockAlignment="center"
                    >
                      <View inlineAlignment="start" minInlineSize="fill">
                        <Text size="small">
                          {quantity}× {item.title}
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