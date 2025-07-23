# Dual Currency Display - Shopify App

Shopify приложение за показване на цени в две валути (лева и евро) на Thank You Page и Order Status Page.

## Функционалности

- ✅ Показва всички цени в две валути (BGN/EUR)
- ✅ Работи само за поръчки с адрес на доставка България  
- ✅ Настройка на основна валута и обменен курс
- ✅ Theme app extension за лесна инсталация
- ✅ Responsive дизайн
- ✅ Railway deployment готов

## Инсталация

### 1. Клониране на проекта
```bash
git clone <your-repo-url>
cd dual-currency-display
```

### 2. Инсталация на dependencies
```bash
npm install
```

### 3. Настройка на environment variables
```bash
cp .env.example .env
```

Попълнете следните стойности в `.env`:
- `SHOPIFY_API_KEY` - от Partner Dashboard
- `SHOPIFY_API_SECRET` - от Partner Dashboard  
- `HOST` - URL на Railway app
- `SHOPIFY_APP_SESSION_SECRET` - random string

### 4. Database setup
```bash
npm run db:generate
npm run db:push
```

### 5. Railway Deployment

1. Свържете проекта с Railway
2. Задайте environment variables в Railway dashboard
3. Deploy се случва автоматично

```bash
railway login
railway link
railway up
```

### 6. Shopify Partner Dashboard

1. Създайте ново app в Partner Dashboard
2. Задайте App URL: `https://your-app.railway.app`
3. Задайте Redirect URL: `https://your-app.railway.app/auth/callback`
4. Копирайте API key и secret в `.env`

### 7. Shopify App Store

1. Качете app-а за review
2. След одобрение ще е достъпен в App Store

## Използване

### За търговци:

1. Инсталирайте app-а от Shopify App Store
2. Отидете в Settings за конфигурация на:
   - Основна валута (BGN/EUR)
   - Обменен курс  
   - Активиране/деактивиране

3. Добавете блока в темата:
   - Admin → Themes → Customize
   - Thank You Page → Add block → "Dual Currency Display"
   - Order Status Page → Add block → "Dual Currency Display"

### За разработчици:

```bash
# Development
npm run dev

# Production build
npm run build
npm start

# Database operations
npm run db:generate  # Generate Prisma client
npm run db:push     # Push schema to database
```

## Структура на проекта

```
dual-currency-display/
├── package.json              # Dependencies (ЕДИН файл в root)
├── index.js                  # Express server
├── remix.config.js           # Remix configuration
├── railway.toml              # Railway deploy config
├── .npmrc                    # NPM settings
├── app/                      # Remix app files
│   ├── root.tsx
│   ├── entry.client.tsx
│   ├── entry.server.tsx
│   ├── shopify.server.ts
│   └── routes/
│       ├── _index.tsx        # Main settings page
│       ├── auth.callback.tsx # OAuth callback
│       └── api.settings.tsx  # Settings API
├── prisma/
│   └── schema.prisma         # Database schema
└── extensions/
    └── dual-currency-display/
        ├── shopify.extension.toml
        ├── blocks/
        │   └── dual-currency.liquid  # Theme block
        └── assets/
            └── dual-currency.css     # Styles
```

## Технически детайли

### Обменен курс
- **BGN → EUR**: Делене на 1.95583
- **EUR → BGN**: Умножение по 1.95583  
- Курсът може да се променя от настройките

### Показване
- Основната валута се показва нормално
- Втората валута се показва в скоби, italic
- Само за поръчки с shipping address България

### Database Schema
```sql
Settings {
  shop: String         # Магазин ID
  baseCurrency: String # BGN или EUR  
  exchangeRate: Float  # Курс BGN/EUR
  isActive: Boolean    # Активен/неактивен
}
```

## Troubleshooting

### Railway Deploy Issues
- Уверете се че използвате Node 18.x
- Проверете дали всички env variables са зададени
- Логовете са достъпни с `railway logs`

### Theme Block не се появява
- Проверете дали адресът на доставка е България
- Проверете дали app-ът е активиран в настройките
- Проверете дали блокът е добавен в темата

### Грешки с Permissions
- Уверете се че app-ът има нужните scopes:
  - `read_orders`
  - `read_themes`  
  - `write_products`

## Support

За въпроси или проблеми, моля създайте issue в GitHub repository-то.

## License

MIT License