import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return NextResponse.json({ error: "Admin not configured" }, { status: 503 });
  }

  if (password !== adminPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Create a simple signed token: hash of password + secret
  const token = createHash("sha256")
    .update(`babji-admin:${adminPassword}`)
    .digest("hex");

  const response = NextResponse.json({ ok: true });
  response.cookies.set("babji_admin", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  });

  return response;
}
