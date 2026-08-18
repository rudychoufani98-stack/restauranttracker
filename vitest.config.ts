import { defineConfig } from "vitest/config";
import path from "path";

// Les tests importent le code applicatif avec l'alias "@/" (comme Next.js).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "node" },
});
