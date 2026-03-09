const fs = require("fs");
const path = require("path");
const envPath = path.join(__dirname, ".env");
const envVars = {};
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        envVars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
  }
}
module.exports = {
  apps: [{
    name: "babji-gateway",
    script: "packages/gateway/dist/index.js",
    cwd: "/opt/babji",
    env: envVars,
    max_restarts: 50,
    restart_delay: 3000,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: "512M",
    log_file: "/var/log/babji-gateway.log",
    error_file: "/var/log/babji-gateway-error.log",
    out_file: "/var/log/babji-gateway-out.log",
    merge_logs: true,
    time: true,
  }]
};
