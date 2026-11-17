// extensions/order-status-ui/src/OrderStatus.jsx
// Order status block (customer-account.order-status.block.render) — Preact + Polaris web components (2025-10+)
import '@shopify/ui-extensions/preact';
import { render } from 'preact';

const EUR_TO_BGN_RATE = 1.95583;

const convertBGNtoEUR = (bgn) => (Number(bgn) / EUR_TO_BGN_RATE).toFixed(2);
const convertEURtoBGN = (eur) => (Number(eur) * EUR_TO_BGN_RATE).toFixed(2);

function dualPrice(amount, isBGN) {
  const a = Number(amount) || 0;
  return isBGN
    ? `${a.toFixed(2)} ЛВ / ${convertBGNtoEUR(a)} EUR`
    : `${a.toFixed(2)} EUR / ${convertEURtoBGN(a)} ЛВ`;
}

export default async () => {
  render(<OrderStatusExtension />, document.body);
};

function OrderStatusExtension() {
  const order = shopify.order?.value;

  if (!order) {
    return (
      <s-box padding="base" border="base" borderRadius="base" background="subdued">
        <s-text>Няма данни за поръчката</s-text>
      </s-box>
    );
  }

  const total = shopify.cost?.totalAmount?.value;
  const shipping = shopify.cost?.totalShippingAmount?.value;
  const lines = shopify.lines?.value || [];
  // Валутата на поръчката (по-надеждно от localization)
  const isBGN = (total?.currencyCode || 'BGN') === 'BGN';

  if (!total || lines.length === 0) {
    return (
      <s-box padding="base" border="base" borderRadius="base" background="subdued">
        <s-stack gap="base">
          <s-heading>🇧🇬 Твоята поръчка 🇪🇺</s-heading>
          <s-text>Поръчка: {order.name || order.id}</s-text>
          <s-text color="subdued">Моля, презаредете страницата ако не виждате данните</s-text>
        </s-stack>
      </s-box>
    );
  }

  return (
    <s-box padding="base" border="base" borderRadius="base" background="subdued">
      <s-stack gap="base">
        <s-heading>🇧🇬 Твоята поръчка 🇪🇺</s-heading>

        <s-box padding="base" borderRadius="base" background="base">
          <s-stack gap="base">
            <s-text type="strong">Продукти:</s-text>

            <s-stack gap="small-200">
              {lines.map((line, index) => {
                const title = line?.merchandise?.title || line?.title || `Продукт ${index + 1}`;
                return (
                  <Row
                    key={line.id || `line-${index}`}
                    label={`${line?.quantity || 1}× ${title}`}
                    value={dualPrice(line?.cost?.totalAmount?.amount, isBGN)}
                  />
                );
              })}
            </s-stack>

            {shipping && Number(shipping.amount) > 0 && (
              <>
                <s-divider />
                <Row label="Доставка" value={dualPrice(shipping.amount, isBGN)} />
              </>
            )}
          </s-stack>
        </s-box>

        <s-box padding="small" borderRadius="base" background="base">
          <Row label="Общо:" value={dualPrice(total.amount, isBGN)} />
        </s-box>

        <s-text color="subdued">
          Курс: 1 EUR = {EUR_TO_BGN_RATE} BGN (фиксиран курс на БНБ)
        </s-text>
      </s-stack>
    </s-box>
  );
}

function Row({ label, value }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
      <s-text>{label}</s-text>
      <s-text type="strong">{value}</s-text>
    </s-stack>
  );
}
