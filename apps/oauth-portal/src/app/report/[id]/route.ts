import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@babji/db";
import { schema } from "@babji/db";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";

function markdownToHtml(md: string): string {
  let html = md
    // Headings
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Horizontal rule
    .replace(/^---$/gm, "<hr/>")
    // Unordered list items
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Wrap remaining plain text lines in <p>
  html = html
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (/^<(h[1-4]|ul|li|hr|p|div|blockquote)/.test(trimmed)) return trimmed;
      return `<p>${trimmed}</p>`;
    })
    .join("\n");

  return html;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    const report = await db.query.reports.findFirst({
      where: eq(schema.reports.id, id),
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    let markdown: string;
    try {
      markdown = await readFile(report.filePath, "utf-8");
    } catch {
      return NextResponse.json(
        { error: "Report file not available" },
        { status: 404 }
      );
    }

    const body = markdownToHtml(markdown);
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Research Report - Babji</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px; margin: 0 auto; padding: 32px 20px; color: #1a1a2e;
      background: #fafafa; line-height: 1.7; }
    h1 { font-size: 1.8rem; margin: 24px 0 16px; color: #16213e; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    h2 { font-size: 1.4rem; margin: 20px 0 12px; color: #1a1a2e; }
    h3 { font-size: 1.15rem; margin: 16px 0 8px; color: #334155; }
    h4 { font-size: 1rem; margin: 12px 0 6px; color: #475569; }
    p { margin: 8px 0; }
    ul { margin: 8px 0 8px 24px; }
    li { margin: 4px 0; }
    strong { color: #1e293b; }
    em { color: #64748b; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    .header { text-align: center; margin-bottom: 32px; padding: 16px; background: #f1f5f9; border-radius: 8px; }
    .header p { color: #64748b; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="header">
    <p>Research Report by <strong>Babji</strong></p>
  </div>
  ${body}
</body>
</html>`;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } finally {
    await close();
  }
}
