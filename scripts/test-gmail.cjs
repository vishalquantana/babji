const { TokenVault } = require("../packages/crypto/dist/index.js");

const vault = new TokenVault(
  process.env.MEMORY_BASE_DIR || "/opt/babji/data/tenants",
  process.env.ENCRYPTION_KEY || ""
);

async function main() {
  const t = await vault.retrieve("3cb42fcb-e6c2-485a-9522-1fec0803be93", "gmail");
  if (!t) {
    console.log("No token found");
    return;
  }
  console.log("Token expires:", new Date(t.expires_at).toISOString());
  console.log("Expired:", Date.now() > t.expires_at);

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=3", {
    headers: { Authorization: "Bearer " + t.access_token },
  });
  const data = await res.json();

  if (data.error) {
    console.log("API ERROR:", data.error.code, data.error.message);
  } else {
    console.log("SUCCESS - messages found:", data.resultSizeEstimate);
    console.log("First 3 IDs:", (data.messages || []).map(m => m.id));
  }
}

main().catch(e => console.error("Error:", e.message));
