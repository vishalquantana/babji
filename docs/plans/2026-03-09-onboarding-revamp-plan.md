# First-Time User Experience Revamp — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign Babji's onboarding so a zero-digital-savvy user experiences value within their first 3 messages, before being asked for personal info or presented with jargon.

**Architecture:** Replace the current single-step onboarding (name → credits dump → phone request → capability list) with a multi-phase conversational flow: name → "what do you do?" → tailored demo suggestion → (Brain handles first real interaction) → natural service introduction after value delivery. Phone number and credits are deferred until contextually relevant.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM (PostgreSQL), Grammy (Telegram), existing Brain/PromptBuilder

---

## Context for Implementer

**Current onboarding flow** (`packages/gateway/src/onboarding.ts`):
1. Unknown sender sends any message → `OnboardingHandler.handle()` is called
2. Empty/unrecognizable text → welcome message asking for name
3. Valid name (2-50 chars, has a letter, not a greeting) → create tenant in DB, init memory + credits
4. Response dumps: credits concept ("juice"), phone number request (Telegram), full capability list

**Current phone collection** (`packages/gateway/src/message-handler.ts:165-263`):
- After onboarding creates a Telegram user, `askedForPhone` flag is set
- Next numeric message is intercepted as a phone number
- Confirmation step, then capability dump

**Key design decisions:**
- Onboarding is *stateless* — each message is evaluated fresh against DB state
- We need a new "phase" concept: `onboardingPhase` column on `tenants` table to track where the user is
- The `OnboardingHandler` only handles brand-new users (no tenant record). Post-creation phases run in `MessageHandler` before the Brain, similar to how phone collection works today.

---

### Task 1: Add `onboardingPhase` column to tenants table

**Files:**
- Modify: `packages/db/src/schema.ts:21-40`

**Step 1: Add the column**

In `packages/db/src/schema.ts`, add an `onboardingPhase` column to the `tenants` table:

```typescript
onboardingPhase: varchar("onboarding_phase", { length: 20 })
  .notNull()
  .default("name"),
```

Add it after the `containerStatus` line (line 32), before `createdAt`.

Valid phases: `"name"` → `"role"` → `"ready"` → `"done"`
- `name`: waiting for name (never actually stored — tenant doesn't exist yet)
- `role`: tenant created, waiting for "what do you do?" answer
- `ready`: role captured, first suggestion sent, user is exploring
- `done`: onboarding complete (user has had at least one Brain interaction)

**Step 2: Run DB migration on production**

```bash
ssh root@65.20.76.199 'docker exec babji-postgres-1 psql -U babji -d babji -c "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_phase VARCHAR(20) NOT NULL DEFAULT '\''done'\'';"'
```

Note: default is `'done'` for existing tenants (they already onboarded). New tenants will be created with `'role'` (set explicitly in onboarding code).

**Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add onboardingPhase column to tenants table"
```

---

### Task 2: Revamp OnboardingHandler — welcome + name → ask role

**Files:**
- Modify: `packages/gateway/src/onboarding.ts`
- Modify: `packages/gateway/src/__tests__/onboarding.test.ts`

**Step 1: Update tests for new flow**

Replace the test file content. Key changes:
- Welcome message no longer mentions credits or capabilities
- Onboarded message asks "what do you do?" instead of phone/capabilities
- Telegram users get `onboardingPhase: "role"` (not phone request)

Add these tests to `packages/gateway/src/__tests__/onboarding.test.ts`:

```typescript
it("onboarded message asks about their work, not credits", async () => {
  const deps = makeDeps();
  const handler = new OnboardingHandler(deps as any);

  const result = await handler.handle(
    makeMessage({ text: "Priya", channel: "telegram", sender: "tg-999" }),
  );

  expect(result.text).toContain("Priya");
  expect(result.text).toContain("what kind of work");
  expect(result.text).not.toContain("credit");
  expect(result.text).not.toContain("juice");
  expect(result.text).not.toContain("phone");
});

it("sets onboardingPhase to 'role' when creating tenant", async () => {
  const deps = makeDeps();
  const handler = new OnboardingHandler(deps as any);

  await handler.handle(
    makeMessage({ text: "Raj", channel: "telegram", sender: "tg-100" }),
  );

  const valuesCall = deps.db.insert.mock.results[0].value.values;
  const insertedData = valuesCall.mock.calls[0][0];
  expect(insertedData.onboardingPhase).toBe("role");
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @babji/gateway test
```

Expected: 2 new tests FAIL (onboarded message still mentions credits; no onboardingPhase field)

**Step 3: Update OnboardingHandler**

In `packages/gateway/src/onboarding.ts`, make these changes:

a) Update `welcomeMessage()`:
```typescript
private welcomeMessage(): string {
  return [
    "Hey there! I'm Babji -- think of me as your business helper who lives right here in this chat.",
    "",
    "What should I call you?",
  ].join("\n");
}
```

b) Update tenant creation to set `onboardingPhase: "role"`:
```typescript
await this.deps.db.insert(schema.tenants).values({
  id: tenantId,
  name,
  phone,
  telegramUserId: channel === "telegram" ? message.sender : null,
  plan: "free",
  timezone: detectedTz ?? "UTC",
  containerStatus: "provisioning",
  onboardingPhase: "role",
});
```

c) Replace `onboardedMessage()` — no credits, no phone, no capability dump:
```typescript
private onboardedMessage(name: string, _channel: string): string {
  return [
    `Nice to meet you, ${name}!`,
    "",
    "Quick question -- what kind of work do you do?",
    "Just tell me in a line, like \"I run a rice shop\" or \"I do digital marketing\".",
  ].join("\n");
}
```

**Step 4: Run tests**

```bash
pnpm --filter @babji/gateway test
```

Expected: all tests pass. Some existing tests may need assertion updates (e.g., tests that check for "5 free daily credits" in the onboarded message).

Update existing test assertions:
- `"creates tenant when a valid name is provided via WhatsApp"` — change `expect(result.text).toContain("5 free daily credits")` to `expect(result.text).toContain("what kind of work")`
- `"creates tenant for Telegram users with telegramUserId"` — same change, plus verify no phone request

**Step 5: Commit**

```bash
git add packages/gateway/src/onboarding.ts packages/gateway/src/__tests__/onboarding.test.ts
git commit -m "feat(onboarding): replace credits/phone dump with 'what do you do?' question"
```

---

### Task 3: Handle "role" phase in MessageHandler — capture role, suggest demo

**Files:**
- Modify: `packages/gateway/src/message-handler.ts:150-165`
- Modify: `packages/memory/src/memory-manager.ts`

This is the core change. After onboarding creates a tenant with `onboardingPhase: "role"`, the user's *next* message (their role/business description) needs to be intercepted before reaching the Brain.

**Step 1: Add `appendMemory` with role fact**

No change needed — `MemoryManager.appendMemory()` already exists and writes to MEMORY.md.

**Step 2: Add role-phase handling in MessageHandler**

In `packages/gateway/src/message-handler.ts`, after the tenant is resolved (around line 163), add a new section before the phone collection block:

```typescript
// ── Handle onboarding phases ──
if (tenant.onboardingPhase === "role") {
  const roleText = message.text.trim();

  // Store the role in memory
  await this.deps.memory.appendMemory(tenantId, `Work/business: ${roleText}`);

  // Detect timezone from role text (e.g., "I run a shop in Mumbai")
  const currentTz = tenant.timezone ?? "UTC";
  if (currentTz === "UTC") {
    const detectedTz = timezoneFromText(roleText);
    if (detectedTz) {
      await this.deps.db.update(schema.tenants)
        .set({ timezone: detectedTz })
        .where(eq(schema.tenants.id, tenantId));
    }
  }

  // Update phase to "ready"
  await this.deps.db.update(schema.tenants)
    .set({ onboardingPhase: "ready" })
    .where(eq(schema.tenants.id, tenantId));

  // Generate tailored suggestions based on role
  const suggestions = this.generateOnboardingSuggestions(roleText);

  return {
    tenantId,
    channel,
    recipient: sender,
    text: [
      `Got it -- ${roleText}, that's interesting!`,
      "",
      "Let me show you what I can do right away. Try asking me something like:",
      "",
      ...suggestions.map((s) => `- "${s}"`),
      "",
      "Just type one of those, or ask me anything you're curious about.",
    ].join("\n"),
  };
}
```

**Step 3: Add the suggestion generator method**

Add a private method to `MessageHandler`:

```typescript
/**
 * Generate 3 tailored suggestions based on the user's role/business.
 * Uses keyword matching — no LLM call needed.
 */
private generateOnboardingSuggestions(role: string): string[] {
  const lower = role.toLowerCase();

  // Default suggestions that work for anyone
  const defaults = [
    "What are the latest trends in my industry?",
    "Remind me to follow up with a client tomorrow at 10am",
    "Find contact info for [a company you're interested in]",
  ];

  // Industry-specific suggestions
  if (/rice|grain|commodity|agri|farm|crop/.test(lower)) {
    return [
      "What is the current market price of basmati rice?",
      "Remind me to call the supplier tomorrow at 10am",
      "Research top rice exporters in India",
    ];
  }
  if (/market|advertis|ads|digital|seo|social media|agency/.test(lower)) {
    return [
      "Research the latest Google Ads best practices",
      "Remind me to send the campaign report by Friday",
      "Find the marketing head at [competitor company]",
    ];
  }
  if (/real estate|property|broker|construction/.test(lower)) {
    return [
      "Research current real estate trends in my city",
      "Remind me to follow up with the buyer tomorrow",
      "Find contact info for [a developer or agency]",
    ];
  }
  if (/restaurant|food|cafe|hotel|hospitality/.test(lower)) {
    return [
      "Research food delivery trends in 2026",
      "Remind me to order supplies by Thursday",
      "Find contact info for [a food supplier]",
    ];
  }
  if (/retail|shop|store|ecommerce|e-commerce/.test(lower)) {
    return [
      "Research trending products in my category",
      "Remind me to restock inventory this week",
      "Find the supplier for [a product you sell]",
    ];
  }
  if (/consult|freelance|coach|train/.test(lower)) {
    return [
      "Research industry benchmarks for my field",
      "Remind me about the client call tomorrow at 3pm",
      "Find the LinkedIn profile of [a potential client]",
    ];
  }
  if (/doctor|clinic|health|medical|pharma/.test(lower)) {
    return [
      "Research recent developments in [your specialty]",
      "Remind me to review patient files before rounds",
      "Find contact info for [a medical supplier]",
    ];
  }
  if (/law|legal|advocate|attorney/.test(lower)) {
    return [
      "Research recent changes in [area of law]",
      "Remind me about the court hearing on Friday",
      "Find the LinkedIn profile of [opposing counsel]",
    ];
  }
  if (/teach|school|education|tutor|professor/.test(lower)) {
    return [
      "Research new teaching methods for [your subject]",
      "Remind me to prepare lesson plans by Sunday",
      "Find educational resources on [topic]",
    ];
  }

  return defaults;
}
```

**Step 4: Commit**

```bash
git add packages/gateway/src/message-handler.ts
git commit -m "feat(onboarding): capture user role and show tailored demo suggestions"
```

---

### Task 4: Handle "ready" phase — transition to Brain after first interaction

**Files:**
- Modify: `packages/gateway/src/message-handler.ts`

When `onboardingPhase` is `"ready"`, the user sends their first real query (e.g., "What is the current price of basmati rice?"). This should go through the normal Brain flow, but afterward we mark `onboardingPhase: "done"`.

**Step 1: Add ready-phase transition**

In `packages/gateway/src/message-handler.ts`, after the `"role"` phase block, add:

```typescript
// When in "ready" phase, let the message flow through to Brain normally.
// After Brain responds, we mark onboarding as done (handled below after Brain processing).
```

Then, after the Brain response is generated and stored in session history (around line 496, after `await this.deps.sessions.append(...)`), add:

```typescript
// ── Complete onboarding after first Brain interaction ──
if (tenant.onboardingPhase === "ready") {
  await this.deps.db.update(schema.tenants)
    .set({ onboardingPhase: "done" })
    .where(eq(schema.tenants.id, tenantId));

  // Append a gentle service introduction to the Brain's response
  const serviceNudge = [
    "",
    "",
    "By the way -- I can also help manage your emails, calendar, and even ads if you use Google.",
    "Want me to connect to any of these? Just say the word.",
  ].join("\n");

  return {
    tenantId,
    channel,
    recipient: sender,
    text: result.content + serviceNudge,
  };
}
```

**Step 2: Commit**

```bash
git add packages/gateway/src/message-handler.ts
git commit -m "feat(onboarding): transition to done after first Brain interaction, nudge services"
```

---

### Task 5: Defer phone number request and credits explanation

**Files:**
- Modify: `packages/gateway/src/message-handler.ts`
- Modify: `packages/agent/src/prompt-builder.ts`

**Step 1: Remove phone collection from post-onboarding**

In `packages/gateway/src/message-handler.ts`, the `askedForPhone` flag is currently set right after onboarding (line 157-159):

```typescript
if (channel === "telegram" && result.tenantId !== "onboarding") {
  this.askedForPhone.add(result.tenantId);
}
```

Remove this block. Phone collection will no longer happen during onboarding.

Also remove the entire phone collection block from the `handle()` method (lines 166-263). We'll keep the `pendingPhones` and `askedForPhone` infrastructure but won't trigger it from onboarding.

Instead, add timezone-aware phone request to the PromptBuilder. When the timezone is UTC and the user tries to set a reminder or schedule something, the Brain should naturally ask for their city or phone number.

**Step 2: Update PromptBuilder for deferred credits**

In `packages/agent/src/prompt-builder.ts`, update the system prompt section that mentions credits. Currently the Soul prompt mentions "juice" but the Brain doesn't know to explain it on first use.

Add a section after the task management rules:

```typescript
parts.push("");
parts.push("## Credits ('juice')");
parts.push("Each action (research, email, calendar, etc.) costs 1 credit. The client gets 5 free daily credits.");
parts.push("Do NOT mention credits proactively. Only mention credits when:");
parts.push("- The client's balance drops to 2 or fewer -- then say 'Heads up, you have X uses left today. They reset tomorrow.'");
parts.push("- The client asks about credits or pricing");
parts.push("- The client runs out of credits");
parts.push("NEVER use the word 'juice' with new users. Just say 'free uses' or 'daily uses'.");
```

**Step 3: Update PromptBuilder for deferred phone/timezone**

The existing UTC timezone note in PromptBuilder already asks about city. Keep that as-is — it naturally handles timezone discovery through conversation.

**Step 4: Remove phone request from the skip/confirm capability dumps**

In `message-handler.ts`, find the blocks that respond after phone confirmation (line 194-207) and after "skip" (line 224-237). These capability dumps ("Here's what I can help with: ...") should be simplified or removed since they only trigger for *existing* users who haven't completed phone collection. For existing users who somehow hit this flow, keep a minimal response:

After phone confirmation success:
```typescript
text: `Saved! ${tzNote}\n\nWhat can I help you with?`,
```

After "skip":
```typescript
text: "No worries! What can I help you with?",
```

**Step 5: Commit**

```bash
git add packages/gateway/src/message-handler.ts packages/agent/src/prompt-builder.ts
git commit -m "feat(onboarding): defer phone and credits to contextually relevant moments"
```

---

### Task 6: Update SOUL.md default template

**Files:**
- Modify: `packages/memory/src/memory-manager.ts:4-34`

**Step 1: Update the DEFAULT_SOUL template**

Remove the line about "Credits = juice" and the URL generation rule (which is redundant with PromptBuilder). The new template should be:

```typescript
const DEFAULT_SOUL = `# Babji

You are Babji, a friendly and capable AI business assistant.
You speak casually but professionally. You're helpful, proactive, and a bit playful.

## Personality
- You remember everything about your client. You're their digital butler.
- When you can't do something, you're honest about it and offer to learn.
- When you need access to a service, you make it easy -- just send a link.
- Never be robotic. Never say "as an AI". You're Babji.
- Learning new skills = "checking with my teacher"
- Heartbeat checks = "just checking in"

## Rules
- Keep responses concise -- this is WhatsApp/Telegram, not an essay
- Use short paragraphs, line breaks for structure
- When taking actions, confirm what you did
- For unknown capabilities: use the babji__check_with_teacher tool to submit a request to your teacher. Tell the user "Let me check with my teacher" and then call the tool. After the tool succeeds, tell the user you've passed it along and your teacher will work on it.
- NEVER offer to do things outside your listed skills. You cannot browse the web, search Reddit, visit URLs, or access any service not listed under "Available skills"
- If the user asks you to do something you can't, say so clearly, then call babji__check_with_teacher to submit the request
- NEVER generate or make up URLs. If a service needs to be connected, use the connect_service tool to generate the proper link

## Email rules
- When sending emails, ALWAYS use the client's real name to sign off -- NEVER use placeholders like [Your Name]
- Before composing an email, if you don't know the client's writing style yet, first read a few of their sent emails (query: "in:sent") to learn their tone, greeting style, and sign-off
- Match the client's writing style: if they write casually, write casually. If formal, be formal.
- Always confirm the draft with the user before sending, unless they explicitly said "just send it"
- NEVER use placeholder text like [Client Name], [Company], etc. If you don't know something, ask the user
`;
```

Note: This only affects *new* tenants. Existing tenants keep their current SOUL.md.

**Step 2: Commit**

```bash
git add packages/memory/src/memory-manager.ts
git commit -m "feat(onboarding): clean up SOUL.md template, remove premature credits/juice reference"
```

---

### Task 7: Build, test, deploy

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Run all tests**

```bash
pnpm --filter @babji/gateway test
```

Expected: all 29+ tests pass

**Step 2: Build**

```bash
pnpm --filter @babji/agent build && pnpm --filter @babji/gateway build
```

**Step 3: Run DB migration**

```bash
ssh root@65.20.76.199 'docker exec babji-postgres-1 psql -U babji -d babji -c "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_phase VARCHAR(20) NOT NULL DEFAULT '\''done'\'';"'
```

**Step 4: Deploy to production**

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

ssh root@65.20.76.199 'cd /opt/babji && pnpm install'

# Restart gateway
ssh root@65.20.76.199 'kill $(pgrep -f "packages/gateway") 2>/dev/null; sleep 1; nohup /opt/babji/start-gateway.sh > /var/log/babji-gateway.log 2>&1 &'

# Verify
ssh root@65.20.76.199 'sleep 3 && tail -10 /var/log/babji-gateway.log'
```

**Step 5: Update changelog**

Add entry to `CHANGELOG.md`:

```markdown
### First-time user experience revamp [DEPLOYED]
- **What:** Redesigned onboarding flow for zero-digital-savvy users. New flow: name → "what do you do?" → tailored demo suggestions → first Brain interaction → gentle service introduction. Phone number deferred to when timezone matters. Credits explained on first use, not upfront. Industry-specific suggestions based on user's stated role.
- **Files:** `packages/gateway/src/onboarding.ts`, `packages/gateway/src/message-handler.ts`, `packages/agent/src/prompt-builder.ts`, `packages/memory/src/memory-manager.ts`, `packages/db/src/schema.ts`
- **DB migration:** `ALTER TABLE tenants ADD COLUMN onboarding_phase VARCHAR(20) NOT NULL DEFAULT 'done'`
```

**Step 6: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add changelog entry for onboarding revamp"
```

---

## Testing Checklist

After deployment, test manually with a fresh Telegram account (or delete an existing tenant):

1. Send `/start` → should get "Hey there! I'm Babji -- think of me as your business helper..."
2. Send a name like "Ravi" → should get "Nice to meet you, Ravi! Quick question -- what kind of work do you do?"
3. Send "I run a rice trading business" → should get tailored suggestions about rice prices, suppliers
4. Send one of the suggestions → should get a real Brain response + gentle service nudge at the end
5. Next message → should go straight to Brain (onboarding done, no more intercepting)
6. No credits mentioned until balance drops to 2
7. No phone request during onboarding at all
