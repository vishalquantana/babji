import { NextRequest, NextResponse } from "next/server";
import { createDb } from "@babji/db";
import { schema } from "@babji/db";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";

function markdownToHtml(md: string): string {
  let html = md
    // Code blocks (fenced)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Headings
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Blockquotes
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    // Horizontal rule
    .replace(/^---$/gm, "<hr/>")
    // Numbered list items
    .replace(/^\d+\. (.+)$/gm, '<li class="ol-item">$1</li>')
    // Unordered list items
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => {
    if (match.includes('class="ol-item"')) {
      return `<ol>${match.replace(/ class="ol-item"/g, "")}</ol>`;
    }
    return `<ul>${match}</ul>`;
  });

  // Merge consecutive blockquotes
  html = html.replace(/(<\/blockquote>\n?<blockquote>)/g, "<br/>");

  // Wrap remaining plain text lines in <p>
  html = html
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (/^<(h[1-4]|ul|ol|li|hr|p|div|blockquote|pre|code)/.test(trimmed)) return trimmed;
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
    const createdAt = report.createdAt ? new Date(report.createdAt).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    }) : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${report.query || "Research Report"} - Babji</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 720px; margin: 0 auto; padding: 40px 24px 80px;
      color: #1a1a2e; background: #fff; line-height: 1.8; font-size: 16px;
    }
    .header {
      text-align: center; margin-bottom: 40px; padding: 24px;
      background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
      border-radius: 12px; border: 1px solid #e2e8f0;
    }
    .header h1 { font-size: 1.5rem; font-weight: 700; color: #1e293b; margin-bottom: 8px; }
    .header .meta { color: #64748b; font-size: 0.85rem; }
    h1 { font-size: 1.75rem; margin: 32px 0 16px; color: #0f172a; font-weight: 700;
         border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    h2 { font-size: 1.35rem; margin: 28px 0 12px; color: #1e293b; font-weight: 600; }
    h3 { font-size: 1.1rem; margin: 20px 0 8px; color: #334155; font-weight: 600; }
    h4 { font-size: 1rem; margin: 16px 0 6px; color: #475569; font-weight: 600; }
    p { margin: 10px 0; color: #334155; }
    ul, ol { margin: 10px 0 10px 28px; }
    li { margin: 6px 0; color: #334155; }
    li::marker { color: #94a3b8; }
    strong { color: #0f172a; font-weight: 600; }
    em { color: #64748b; font-style: italic; }
    a { color: #2563eb; text-decoration: none; border-bottom: 1px solid #93c5fd; }
    a:hover { color: #1d4ed8; border-bottom-color: #2563eb; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 32px 0; }
    blockquote {
      margin: 16px 0; padding: 12px 20px;
      border-left: 3px solid #6366f1; background: #f8fafc;
      color: #475569; border-radius: 0 8px 8px 0;
    }
    code {
      font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, monospace;
      background: #f1f5f9; padding: 2px 6px; border-radius: 4px;
      font-size: 0.9em; color: #e11d48;
    }
    pre {
      margin: 16px 0; padding: 16px 20px;
      background: #1e293b; border-radius: 8px; overflow-x: auto;
    }
    pre code {
      background: none; color: #e2e8f0; padding: 0;
      font-size: 0.85rem; line-height: 1.6;
    }
    .footer {
      margin-top: 48px; padding-top: 24px; border-top: 1px solid #e2e8f0;
      text-align: center; color: #94a3b8; font-size: 0.8rem;
    }
    @media (max-width: 640px) {
      body { padding: 20px 16px 60px; font-size: 15px; }
      h1 { font-size: 1.4rem; }
      h2 { font-size: 1.2rem; }
      .header { padding: 16px; }
      .header h1 { font-size: 1.25rem; }
    }
    @media print {
      body { max-width: 100%; padding: 0; }
      .header { background: none; border: 1px solid #ccc; }
      a { color: #000; border-bottom: none; }
      a::after { content: " (" attr(href) ")"; font-size: 0.8em; color: #666; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${report.query || "Research Report"}</h1>
    <div class="meta">Prepared by <strong>Babji</strong>${createdAt ? ` · ${createdAt}` : ""}</div>
  </div>
  ${body}
  <div class="footer">
    <p>Generated by Babji — AI Business Assistant</p>
  </div>
</body>
</html>`;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } finally {
    await close();
  }
}
