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
