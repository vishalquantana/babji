import { createHash } from "node:crypto";
import { cookies } from "next/headers";

export async function isAdminAuthenticated(): Promise<boolean> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;

  const cookieStore = await cookies();
  const token = cookieStore.get("babji_admin")?.value;
  if (!token) return false;

  const expected = createHash("sha256")
    .update(`babji-admin:${adminPassword}`)
    .digest("hex");

  return token === expected;
}
