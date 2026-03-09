# People Researcher Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "People Research" skill that finds professional profiles via DataForSEO Google search + Scrapin.io LinkedIn enrichment.

**Architecture:** DataForSEO searches `site:linkedin.com/in <name> <company>` to find LinkedIn URLs cheaply, then Scrapin.io enriches the profile. Four actions: research_person, lookup_profile, find_email, research_company. No OAuth — server-side API keys via env vars.

**Tech Stack:** Node.js fetch API, DataForSEO REST API, Scrapin.io REST API, existing Babji skill handler pattern.

---

### Task 1: Create the PeopleHandler class

**Files:**
- Create: `packages/skills/src/people/handler.ts`
- Create: `packages/skills/src/people/index.ts`

**Step 1: Create the handler with all four actions**

```typescript
// packages/skills/src/people/handler.ts
import type { SkillHandler } from "@babji/agent";

interface DataForSeoConfig {
  login: string;
  password: string;
}

interface ScrapinConfig {
  apiKey: string;
}

export class PeopleHandler implements SkillHandler {
  private dataforseo: DataForSeoConfig;
  private scrapin: ScrapinConfig;

  constructor(dataforseo: DataForSeoConfig, scrapin: ScrapinConfig) {
    this.dataforseo = dataforseo;
    this.scrapin = scrapin;
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "research_person":
        return this.researchPerson(
          params.name as string,
          params.company_or_domain as string,
        );
      case "lookup_profile":
        return this.lookupProfile(params.linkedin_url as string);
      case "find_email":
        return this.findEmail(
          params.first_name as string,
          params.last_name as string,
          params.company_name as string,
        );
      case "research_company":
        return this.researchCompany(params.domain as string);
      default:
        throw new Error(`Unknown people action: ${actionName}`);
    }
  }

  private async researchPerson(name: string, companyOrDomain: string) {
    // Step 1: Search Google via DataForSEO for LinkedIn URL
    const linkedInUrl = await this.searchLinkedIn(name, companyOrDomain);
    if (!linkedInUrl) {
      return { found: false, message: `Could not find a LinkedIn profile for "${name}" at "${companyOrDomain}".` };
    }

    // Step 2: Enrich via Scrapin.io
    const profile = await this.enrichProfile(linkedInUrl);
    return { found: true, ...profile };
  }

  private async lookupProfile(linkedInUrl: string) {
    const profile = await this.enrichProfile(linkedInUrl);
    return { found: true, ...profile };
  }

  private async findEmail(firstName: string, lastName: string, companyName: string) {
    const res = await fetch(
      `https://api.scrapin.io/v1/enrichment/emails/finder?apikey=${this.scrapin.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, companyName }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Scrapin email finder failed (${res.status}): ${body}`);
    }

    const data = await res.json() as Record<string, unknown>;
    if (!data.success) {
      return { found: false, message: "Could not find email addresses for this person." };
    }

    return { found: true, emails: data.emails };
  }

  private async researchCompany(domain: string) {
    const res = await fetch(
      `https://api.scrapin.io/v1/enrichment/company/domain?apikey=${this.scrapin.apiKey}&domain=${encodeURIComponent(domain)}`,
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Scrapin company lookup failed (${res.status}): ${body}`);
    }

    const data = await res.json() as Record<string, unknown>;
    if (!data.success) {
      return { found: false, message: `Could not find company information for "${domain}".` };
    }

    const company = data.company as Record<string, unknown> | undefined;
    if (!company) {
      return { found: false, message: `No company data returned for "${domain}".` };
    }

    return {
      found: true,
      name: company.name,
      industry: company.industry,
      description: company.description,
      staffCount: company.staffCount,
      headquarter: company.headquarter,
      websiteUrl: company.websiteUrl,
      linkedInUrl: company.linkedInUrl,
      specialities: company.specialities,
    };
  }

  private async searchLinkedIn(name: string, companyOrDomain: string): Promise<string | null> {
    const keyword = `site:linkedin.com/in ${name} ${companyOrDomain}`;
    const auth = Buffer.from(`${this.dataforseo.login}:${this.dataforseo.password}`).toString("base64");

    const res = await fetch(
      "https://api.dataforseo.com/v3/serp/google/organic/live/regular",
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{
          language_code: "en",
          location_code: 2840,
          keyword,
          depth: 5,
        }]),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DataForSEO search failed (${res.status}): ${body}`);
    }

    const data = await res.json() as {
      tasks?: Array<{
        result?: Array<{
          items?: Array<{ type: string; url: string }>;
        }>;
      }>;
    };

    const items = data.tasks?.[0]?.result?.[0]?.items || [];
    for (const item of items) {
      if (item.type === "organic" && item.url.includes("linkedin.com/in/")) {
        return item.url;
      }
    }

    return null;
  }

  private async enrichProfile(linkedInUrl: string) {
    const res = await fetch(
      `https://api.scrapin.io/v1/enrichment/profile?apikey=${this.scrapin.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedInUrl,
          cacheDuration: "1w",
          includes: {
            includeCompany: true,
            includeSummary: true,
            includeExperience: true,
            includeEducation: true,
            includeSkills: true,
          },
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Scrapin profile enrichment failed (${res.status}): ${body}`);
    }

    const data = await res.json() as Record<string, unknown>;
    if (!data.success) {
      return { found: false, message: "LinkedIn profile exists but could not be enriched." };
    }

    const person = data.person as Record<string, unknown> | undefined;
    if (!person) {
      return { found: false, message: "No profile data returned." };
    }

    const positions = person.positions as { positionHistory?: Array<Record<string, unknown>> } | undefined;
    const education = person.educations as Array<Record<string, unknown>> | undefined;

    return {
      linkedInUrl,
      firstName: person.firstName,
      lastName: person.lastName,
      headline: person.headline,
      location: person.location,
      summary: person.summary,
      experience: positions?.positionHistory?.slice(0, 5)?.map((p) => ({
        title: p.title,
        company: p.companyName,
        startDate: p.startEndDate,
        description: p.description,
      })),
      education: education?.slice(0, 3)?.map((e) => ({
        school: e.schoolName,
        degree: e.degreeName,
        field: e.fieldOfStudy,
      })),
      skills: person.skills,
      company: data.company,
    };
  }
}
```

```typescript
// packages/skills/src/people/index.ts
export { PeopleHandler } from "./handler.js";
```

**Step 2: Commit**

```bash
git add packages/skills/src/people/
git commit -m "feat: add PeopleHandler with DataForSEO + Scrapin.io"
```

---

### Task 2: Register skill definition in registry

**Files:**
- Modify: `packages/skills/src/registry.ts`

**Step 1: Add the people skill definition after checkWithTeacherSkill**

```typescript
const peopleSkill: SkillDefinition = {
  name: "people",
  displayName: "People Research",
  description: "Research people, companies, and find contact details using LinkedIn and public data.",
  actions: [
    {
      name: "research_person",
      description: "Search for a person by name and company/domain. Returns their professional profile, work history, and LinkedIn URL.",
      parameters: {
        name: {
          type: "string",
          required: true,
          description: "Person's name (first, last, or full name)",
        },
        company_or_domain: {
          type: "string",
          required: true,
          description: "Company name or website domain to narrow the search",
        },
      },
    },
    {
      name: "lookup_profile",
      description: "Look up a LinkedIn profile directly by URL. Use when the user provides a LinkedIn link.",
      parameters: {
        linkedin_url: {
          type: "string",
          required: true,
          description: "Full LinkedIn profile URL (e.g. https://linkedin.com/in/username)",
        },
      },
    },
    {
      name: "find_email",
      description: "Find verified email addresses for a person given their name and company.",
      parameters: {
        first_name: {
          type: "string",
          required: true,
          description: "Person's first name",
        },
        last_name: {
          type: "string",
          required: true,
          description: "Person's last name",
        },
        company_name: {
          type: "string",
          required: true,
          description: "Company name where the person works",
        },
      },
    },
    {
      name: "research_company",
      description: "Look up company information from a website domain. Returns industry, size, headquarters, and description.",
      parameters: {
        domain: {
          type: "string",
          required: true,
          description: "Company website domain (e.g. quantana.com.au)",
        },
      },
    },
  ],
  creditsPerAction: 1,
};
```

Update the allSkills array:

```typescript
const allSkills: SkillDefinition[] = [gmailSkill, calendarSkill, googleAdsSkill, googleAnalyticsSkill, checkWithTeacherSkill, peopleSkill];
```

**Step 2: Commit**

```bash
git add packages/skills/src/registry.ts
git commit -m "feat: add people skill definition to registry"
```

---

### Task 3: Export PeopleHandler and register in message handler

**Files:**
- Modify: `packages/skills/src/index.ts` — add export
- Modify: `packages/gateway/src/message-handler.ts` — register handler
- Modify: `packages/gateway/src/config.ts` — add env var config

**Step 1: Add export to skills index**

Add to `packages/skills/src/index.ts`:
```typescript
export { PeopleHandler } from "./people/index.js";
```

**Step 2: Add config for DataForSEO and Scrapin.io**

In `packages/gateway/src/config.ts`, add to the interface:
```typescript
  people: {
    enabled: boolean;
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
```

And in `loadConfig()`:
```typescript
    people: {
      enabled: !!process.env.SCRAPIN_API_KEY && !!process.env.DATAFORSEO_LOGIN,
      scrapinApiKey: process.env.SCRAPIN_API_KEY || "",
      dataforseoLogin: process.env.DATAFORSEO_LOGIN || "",
      dataforseoPassword: process.env.DATAFORSEO_PASSWORD || "",
    },
```

**Step 3: Register handler in message-handler.ts**

Add import:
```typescript
import { GmailHandler, GoogleCalendarHandler, GoogleAdsHandler, GoogleAnalyticsHandler, PeopleHandler } from "@babji/skills";
```

After the "check with my teacher" handler registration block (~line 348), add:
```typescript
      // ── Register people research handler (always available, server-side keys) ──
      if (config.people.enabled) {
        toolExecutor.registerSkill("people", new PeopleHandler(
          { login: config.people.dataforseoLogin, password: config.people.dataforseoPassword },
          { apiKey: config.people.scrapinApiKey },
        ));
      }
```

Note: `config` is not currently available in the message handler. It needs to be passed via deps. Add `peopleConfig` to `MessageHandlerDeps`:

```typescript
// In MessageHandlerDeps interface:
  peopleConfig?: {
    enabled: boolean;
    scrapinApiKey: string;
    dataforseoLogin: string;
    dataforseoPassword: string;
  };
```

Then in the handler registration, use `this.deps.peopleConfig`:
```typescript
      if (this.deps.peopleConfig?.enabled) {
        toolExecutor.registerSkill("people", new PeopleHandler(
          { login: this.deps.peopleConfig.dataforseoLogin, password: this.deps.peopleConfig.dataforseoPassword },
          { apiKey: this.deps.peopleConfig.scrapinApiKey },
        ));
      }
```

And in `packages/gateway/src/index.ts`, pass it to MessageHandler:
```typescript
  const handler = new MessageHandler({
    // ... existing deps ...
    peopleConfig: config.people,
  });
```

**Step 4: Commit**

```bash
git add packages/skills/src/index.ts packages/gateway/src/message-handler.ts packages/gateway/src/config.ts packages/gateway/src/index.ts
git commit -m "feat: wire PeopleHandler into gateway"
```

---

### Task 4: Build, test, and deploy

**Step 1: Build all affected packages**

```bash
pnpm --filter @babji/skills build
pnpm --filter @babji/agent build
pnpm --filter @babji/gateway build
```

**Step 2: Run tests**

```bash
pnpm --filter @babji/gateway test
```

Expected: 29/29 pass

**Step 3: Add env vars to production server**

```bash
ssh root@65.20.76.199 "cat >> /opt/babji/.env << 'EOF'

# People research APIs
SCRAPIN_API_KEY=sk_51711f0c2f34b76e09d6f174c2e7c0a83f0e565a
DATAFORSEO_LOGIN=vishal@quantana.com.au
DATAFORSEO_PASSWORD=d68a07c4bff33c0f
EOF"
```

**Step 4: Deploy**

```bash
rsync -az --delete --exclude node_modules --exclude .git --exclude .env --exclude data \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

ssh root@65.20.76.199 "cd /opt/babji && pnpm install --frozen-lockfile"
ssh root@65.20.76.199 "cd /opt/babji && npx pm2 delete babji-gateway && npx pm2 start ecosystem.config.cjs && npx pm2 save"
```

**Step 5: Verify startup**

```bash
ssh root@65.20.76.199 "sleep 3 && tail -10 /var/log/babji-gateway.log"
```

Expected: skills list includes "people"

**Step 6: Test via Telegram**

Send to Babji: "Research Vishal Kumar from Quantana"
Expected: Returns professional profile with LinkedIn data.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: deploy people researcher skill"
```

---

### Task 5: Update BAB-2 Jira ticket to Done

```bash
curl -s -X PUT "https://quantana.atlassian.net/rest/api/3/issue/BAB-2" \
  -u "v@quantana.in:JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"summary":"Skill request: people_researcher (from Vishal) - DONE"}}'
```

Then transition to Done status via the Jira transitions API.
