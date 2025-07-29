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
  useSettings,
  useExtensionApi
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
  const settings = useSettings();
  const api = useExtensionApi();
  
  // ПРОВЕРКА - показваме САМО за България (същата логика като Checkout.jsx)
  const isBulgaria = country?.isoCode === 'BG' || 
                     market?.handle === 'bulgaria' || 
                     market?.handle === 'bg';
  
  if (!isBulgaria) {
    return null;
  }
  
  // За сега показваме информативен блок с курса
  // Order Status page има ограничен достъп до данни
  const showRateInfo = settings?.show_rate_info !== false;
  const highlightEuroSwitch = settings?.highlight_euro_switch !== false;
  
  return (
    <View padding="base" border="base" background="subdued">
      <BlockStack spacing="base">
        {/* Заглавие с флагове */}
        <Text size="medium" emphasis="bold">
          🇧🇬 Валутен курс BGN/EUR 🇪🇺
        </Text>
        
        {/* Информация за курса */}
        {showRateInfo && (
          <View padding="base" background="base" cornerRadius="base">
            <BlockStack spacing="tight">
              <InlineLayout spacing="base" blockAlignment="center">
                <Text size="small">🇧🇬 1 BGN =</Text>
                <Text size="small" emphasis="bold">0.51129 EUR</Text>
              </InlineLayout>
              
              <InlineLayout spacing="base" blockAlignment="center">
                <Text size="small">🇪🇺 1 EUR =</Text>
                <Text size="small" emphasis="bold">{EUR_TO_BGN_RATE} BGN</Text>
              </InlineLayout>
            </BlockStack>
          </View>
        )}
        
        {/* Информация за преминаване към евро */}
        {highlightEuroSwitch && (
          <>
            <Divider />
            <View padding="tight">
              <BlockStack spacing="tight">
                <Text size="small" emphasis="bold">
                  ℹ️ Важна информация
                </Text>
                <Text size="small" appearance="subdued">
                  От 01.01.2026 г. България преминава към евро. 
                  Всички цени ще бъдат автоматично конвертирани.
                </Text>
              </BlockStack>
            </View>
          </>
        )}
        
        {/* Footer */}
        <View padding="extraTight">
          <Text size="small" appearance="subdued">
            Фиксиран курс на БНБ
          </Text>
        </View>
      </BlockStack>
    </View>
  );
}