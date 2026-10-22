import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Zero-config default so a fresh clone works without creating a .env first.
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
