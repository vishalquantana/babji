import { NextResponse } from "next/server";
import { createDb, schema } from "@babji/db";
import { eq } from "drizzle-orm";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { PeopleHandler } from "@babji/skills";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    const profile = await db.query.profileDirectory.findFirst({
      where: eq(schema.profileDirectory.id, id),
    });

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (!profile.linkedinUrl) {
      return NextResponse.json(
        { error: "No LinkedIn URL to scrape" },
        { status: 400 },
      );
    }

    const scrapinApiKey = process.env.SCRAPIN_API_KEY;
    const dataforseoLogin = process.env.DATAFORSEO_LOGIN;
    const dataforseoPassword = process.env.DATAFORSEO_PASSWORD;

    if (!scrapinApiKey || !dataforseoLogin || !dataforseoPassword) {
      return NextResponse.json(
        { error: "People research config not available" },
        { status: 503 },
      );
    }

    const people = new PeopleHandler(
      { login: dataforseoLogin, password: dataforseoPassword },
      { apiKey: scrapinApiKey },
    );

    const result = (await people.execute("lookup_profile", {
      linkedin_url: profile.linkedinUrl,
    })) as Record<string, unknown>;

    await db
      .update(schema.profileDirectory)
      .set({
        scrapedData: result,
        scrapedAt: new Date(),
        status: "corrected",
        verifiedBy: "admin",
        verifiedAt: new Date(),
      })
      .where(eq(schema.profileDirectory.id, id));

    return NextResponse.json({ ok: true, profile: result });
  } finally {
    await close();
  }
}
