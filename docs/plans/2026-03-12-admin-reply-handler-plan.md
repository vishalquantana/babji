# Admin Reply Handler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow admin to reply to Telegram profile notifications with LinkedIn URLs to correct and re-scrape attendee profiles.

**Architecture:** Extend the existing `AdminNotifier` class with a Grammy message listener (`bot.on("message:text")`), an in-memory recent-attendees buffer, and reply parsing logic that uses LLM for ambiguous matches. No new files — everything lives in `admin-notifier.ts`.

**Tech Stack:** Grammy (Telegram bot), Drizzle ORM (PostgreSQL), PeopleHandler (Scrapin API), MultiModelLlmClient (Gemini lite for matching)

**Design doc:** `docs/plans/2026-03-12-admin-reply-handler-design.md`

---

### Task 1: Add state and deps interface to AdminNotifier

**Files:**
- Modify: `packages/gateway/src/admin-notifier.ts:1-20`

**Step 1: Add imports and interfaces**

Add after the existing imports at line 2:

```typescript
import { eq } from "drizzle-orm";
import { schema } from "@babji/db";
import { PeopleHandler } from "@babji/skills";
```

Add below the `JiraConfig` interface (after line 9):

```typescript
interface RecentAttendee {
  email: string;
  displayName: string;
  meeting: string;
  tenantName: string;
  notifiedAt: Date;
}

interface PendingDisambiguation {
  linkedinUrl: string;
  candidates: Array<{ email: string; displayName: string }>;
  expiresAt: Date;
}

interface AdminReplyDeps {
  db: any;
  peopleConfig: {
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
  llmLite: { generateText: (opts: { model: string; system: string; prompt: string }) => Promise<{ text: string }> };
}
```

**Step 2: Add new private fields to the class**

Add after the existing `private jira` field (line 14):

```typescript
  private recentAttendees: RecentAttendee[] = [];
  private pendingDisambiguation: PendingDisambiguation | null = null;
  private replyDeps: AdminReplyDeps | null = null;
```

**Step 3: Commit**

```bash
git add packages/gateway/src/admin-notifier.ts
git commit -m "feat(admin): add state and interfaces for reply handler"
```

---

### Task 2: Populate recentAttendees from notifyNewProfiles

**Files:**
- Modify: `packages/gateway/src/admin-notifier.ts` — `notifyNewProfiles()` method (line 52-68)

**Step 1: Add attendee tracking in notifyNewProfiles**

Add at the start of the `notifyNewProfiles` method body (before the `const lines` line):

```typescript
    // Track notified attendees for reply matching
    const now = new Date();
    for (const p of profiles) {
      this.recentAttendees.push({
        email: p.email,
        displayName: p.displayName,
        meeting: p.meeting,
        tenantName: p.tenantName,
        notifiedAt: now,
      });
    }
    // Prune: keep max 50 entries, remove older than 48 hours
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    this.recentAttendees = this.recentAttendees
      .filter(a => a.notifiedAt > cutoff)
      .slice(-50);
```

**Step 2: Update notification message footer**

Replace the existing footer lines (line 64-65):

```typescript
    lines.push("");
    lines.push("Review & correct: babji.quantana.top/admin -> Profile Directory");
```

With:

```typescript
    lines.push("");
    lines.push("Reply with a LinkedIn URL to update a profile.");
```

**Step 3: Commit**

```bash
git add packages/gateway/src/admin-notifier.ts
git commit -m "feat(admin): track notified attendees and update notification footer"
```

---

### Task 3: Implement handleReply core logic

**Files:**
- Modify: `packages/gateway/src/admin-notifier.ts` — add `handleReply()` method

**Step 1: Add the handleReply method**

Add before the `private async createJiraTicket` method:

```typescript
  async handleReply(text: string): Promise<void> {
    if (!this.replyDeps) return;

    const trimmed = text.trim();

    // 1. Check for pending disambiguation (admin replies with a number)
    if (this.pendingDisambiguation) {
      const disambig = this.pendingDisambiguation;
      if (disambig.expiresAt < new Date()) {
        this.pendingDisambiguation = null;
      } else {
        const num = parseInt(trimmed, 10);
        if (num >= 1 && num <= disambig.candidates.length) {
          this.pendingDisambiguation = null;
          const chosen = disambig.candidates[num - 1];
          await this.updateProfile(chosen.email, disambig.linkedinUrl);
          return;
        }
        // Not a valid number — fall through to normal parsing
      }
    }

    // 2. Extract LinkedIn URL from text
    const linkedinMatch = trimmed.match(
      /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+\/?/i,
    );
    if (!linkedinMatch) return; // Not a profile correction — ignore silently

    const linkedinUrl = linkedinMatch[0].startsWith("http")
      ? linkedinMatch[0]
      : `https://${linkedinMatch[0]}`;

    // 3. Check for email + LinkedIn URL format
    const emailMatch = trimmed.match(
      /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/,
    );
    if (emailMatch) {
      const email = emailMatch[1].toLowerCase();
      await this.updateProfile(email, linkedinUrl);
      return;
    }

    // 4. Bare LinkedIn URL — use LLM to match against recent attendees
    if (this.recentAttendees.length === 0) {
      await this.notify("No recent attendees to match against. Include the email address with the URL.");
      return;
    }

    await this.matchWithLlm(linkedinUrl);
  }
```

**Step 2: Commit**

```bash
git add packages/gateway/src/admin-notifier.ts
git commit -m "feat(admin): add handleReply with parsing and disambiguation"
```

---

### Task 4: Implement LLM matching for bare URLs

**Files:**
- Modify: `packages/gateway/src/admin-notifier.ts` — add `matchWithLlm()` method

**Step 1: Add the matchWithLlm method**

Add after `handleReply`:

```typescript
  private async matchWithLlm(linkedinUrl: string): Promise<void> {
    if (!this.replyDeps) return;

    const attendeeList = this.recentAttendees
      .map((a, i) => `${i + 1}. ${a.email} → ${a.displayName} (Meeting: "${a.meeting}")`)
      .join("\n");

    const system = `You match LinkedIn URLs to meeting attendees. Reply ONLY with valid JSON, no markdown.`;
    const prompt = `Recent meeting attendees:\n${attendeeList}\n\nLinkedIn URL: ${linkedinUrl}\n\nWhich attendee does this URL most likely belong to? Consider the name in the URL slug vs attendee names.\nReply with JSON: { "email": "<matched-email>", "confidence": "high" }\nIf genuinely ambiguous between 2+ people, reply: { "email": null, "confidence": "ambiguous", "candidates": ["email1", "email2"] }`;

    try {
      const result = await this.replyDeps.llmLite.generateText({
        model: process.env.GOOGLE_LITE_MODEL || "gemini-2.0-flash-lite",
        system,
        prompt,
      });

      const cleaned = result.text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned) as {
        email: string | null;
        confidence: string;
        candidates?: string[];
      };

      if (parsed.confidence === "high" && parsed.email) {
        await this.updateProfile(parsed.email, linkedinUrl);
      } else if (parsed.confidence === "ambiguous" && parsed.candidates) {
        // Store disambiguation state
        this.pendingDisambiguation = {
          linkedinUrl,
          candidates: parsed.candidates.map(email => {
            const attendee = this.recentAttendees.find(a => a.email === email);
            return { email, displayName: attendee?.displayName || email };
          }),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min TTL
        };
        const options = this.pendingDisambiguation.candidates
          .map((c, i) => `${i + 1}. ${c.displayName} (${c.email})`)
          .join("\n");
        await this.notify(`Which attendee?\n${options}\n\nReply with the number.`);
      } else {
        await this.notify("Could not match that URL to a recent attendee. Include the email address.");
      }
    } catch (err) {
      logger.error({ err }, "LLM match failed for admin reply");
      await this.notify("Could not process that URL. Try: email linkedin-url");
    }
  }
```

**Step 2: Commit**

```bash
git add packages/gateway/src/admin-notifier.ts
git commit -m "feat(admin): add LLM-based LinkedIn URL matching"
```

---

### Task 5: Implement updateProfile (re-scrape + DB update)

**Files:**
- Modify: `packages/gateway/src/admin-notifier.ts` — add `updateProfile()` method

**Step 1: Add the updateProfile method**

Add after `matchWithLlm`:

```typescript
  private async updateProfile(email: string, linkedinUrl: string): Promise<void> {
    if (!this.replyDeps) return;

    const normalizedEmail = email.toLowerCase();
    const { db, peopleConfig } = this.replyDeps;

    // Check if profile exists in directory
    const existing = await db.query.profileDirectory.findFirst({
      where: eq(schema.profileDirectory.email, normalizedEmail),
    });

    const displayName = existing?.displayName
      || this.recentAttendees.find(a => a.email === normalizedEmail)?.displayName
      || normalizedEmail;

    // Re-scrape via Scrapin
    let scrapedData: Record<string, unknown> | null = null;
    let scrapeError = false;

    try {
      const people = new PeopleHandler(
        { login: peopleConfig.dataforseoLogin, password: peopleConfig.dataforseoPassword },
        { apiKey: peopleConfig.scrapinApiKey },
      );
      const result = await people.execute("lookup_profile", { linkedin_url: linkedinUrl });
      if (result && typeof result === "object" && (result as any).found) {
        scrapedData = result as Record<string, unknown>;
      } else {
        scrapeError = true;
      }
    } catch (err) {
      logger.error({ err, email: normalizedEmail, linkedinUrl }, "Scrapin enrichment failed for admin correction");
      scrapeError = true;
    }

    // Upsert profile_directory
    const now = new Date();
    const values = {
      email: normalizedEmail,
      displayName,
      linkedinUrl,
      scrapedData,
      status: "corrected" as const,
      scrapedAt: scrapeError ? existing?.scrapedAt : now,
      verifiedBy: "admin-telegram",
      verifiedAt: now,
    };

    if (existing) {
      await db.update(schema.profileDirectory)
        .set(values)
        .where(eq(schema.profileDirectory.email, normalizedEmail));
    } else {
      await db.insert(schema.profileDirectory).values(values);
    }

    // Confirm to admin
    if (scrapeError) {
      await this.notify(`Updated LinkedIn URL for ${displayName} (${normalizedEmail}) but enrichment failed — will retry on next briefing.`);
    } else {
      await this.notify(`✓ Updated ${displayName} (${normalizedEmail}) with ${linkedinUrl}`);
    }

    logger.info({ email: normalizedEmail, linkedinUrl, scrapeError }, "Admin corrected profile via Telegram");
  }
```

**Step 2: Commit**

```bash
git add packages/gateway/src/admin-notifier.ts
git commit -m "feat(admin): add updateProfile with Scrapin re-scrape and DB upsert"
```

---

### Task 6: Implement startListening and wire up the message handler

**Files:**
- Modify: `packages/gateway/src/admin-notifier.ts` — add `startListening()` method

**Step 1: Add the startListening method**

Add after the constructor (after line 20):

```typescript
  startListening(deps: AdminReplyDeps): void {
    this.replyDeps = deps;

    this.bot.on("message:text", async (ctx) => {
      // Only process messages from the admin chat
      if (String(ctx.chat.id) !== this.chatId) return;

      try {
        await this.handleReply(ctx.message.text);
      } catch (err) {
        logger.error({ err }, "Failed to handle admin reply");
      }
    });

    this.bot.start({
      onStart: () => logger.info("Admin bot listening for replies"),
    });
  }

  stop(): void {
    this.bot.stop();
  }
```

**Step 2: Commit**

```bash
git add packages/gateway/src/admin-notifier.ts
git commit -m "feat(admin): add startListening with Grammy message handler"
```

---

### Task 7: Wire up in index.ts and graceful shutdown

**Files:**
- Modify: `packages/gateway/src/index.ts:57-77` (admin notifier setup) and `269-280` (shutdown)

**Step 1: Start admin bot listening after initialization**

After line 76 (`logger.info("Admin bot notifications enabled");`), add:

```typescript
    // Start listening for admin replies (profile corrections)
    if (config.people.enabled) {
      adminNotifier.startListening({
        db,
        peopleConfig: {
          scrapinApiKey: config.people.scrapinApiKey,
          dataforseoLogin: config.people.dataforseoLogin,
          dataforseoPassword: config.people.dataforseoPassword,
        },
        llmLite,
      });
    }
```

**Step 2: Add graceful shutdown for admin bot**

In the `shutdown` function, add before `await server.close();` (line 275):

```typescript
    if (adminNotifier) {
      adminNotifier.stop();
    }
```

**Step 3: Commit**

```bash
git add packages/gateway/src/index.ts
git commit -m "feat(admin): wire up admin reply listener at startup with graceful shutdown"
```

---

### Task 8: Build, test, deploy

**Files:**
- All modified files

**Step 1: Build agent package (dependency)**

```bash
pnpm --filter @babji/agent build
```

Expected: Clean build, no errors.

**Step 2: Build gateway package**

```bash
pnpm --filter @babji/gateway build
```

Expected: Clean build, no errors. If type errors occur, fix them before proceeding.

**Step 3: Run tests**

```bash
pnpm --filter @babji/gateway test
```

Expected: All 33 tests pass. The new code doesn't break existing tests since it's additive.

**Step 4: Commit any remaining fixes**

If build/test required changes, commit them.

**Step 5: Deploy to production**

```bash
# Sync code
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

# Install deps
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile'

# Restart gateway
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway'

# Verify health
ssh root@65.20.76.199 'sleep 3 && curl -s http://localhost:3000/health'
```

Expected: `{"status":"ok",...}`

**Step 6: Verify admin bot is listening**

```bash
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 logs babji-gateway --lines 10 --nostream 2>&1 | grep -i admin'
```

Expected: Log line containing `"Admin bot listening for replies"`

**Step 7: Commit deploy note to CHANGELOG**

```bash
git add CHANGELOG.md
git commit -m "docs: add admin reply handler to CHANGELOG"
```
