import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';

config(); // load .env before Prisma reads DATABASE_URL

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
