# Use Node 18 for compatibility
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json .
COPY .npmrc .

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Generate Prisma client
RUN npm run db:generate

# Build the app
RUN npm run build

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "start"]