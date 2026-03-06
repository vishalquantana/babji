import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const server = createServer(config);
  await server.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Babji Gateway running on port ${config.port}`);
}

main().catch((err) => {
  console.error("Gateway startup failed:", err);
  process.exit(1);
});
