# People Researcher Skill Design

**Date:** 2026-03-09
**Jira:** BAB-2
**Status:** Approved

## Overview

A "People Research" skill that lets users look up professional profiles, company info, and contact details by name, company, or LinkedIn URL. Always-on for all tenants using server-side API keys.

## Data Sources

1. **DataForSEO** — Google SERP API for finding LinkedIn URLs from name + company
2. **Scrapin.io** — LinkedIn profile enrichment, email finder, company lookup

## Flow

```
User: "Research Bhanu from windo.africa"
  -> Brain calls people__research_person(name="Bhanu", company_or_domain="windo.africa")
    -> Step 1: DataForSEO Google search: "site:linkedin.com/in Bhanu windo.africa"
    -> Step 2: Extract LinkedIn URL from top organic result
    -> Step 3: Scrapin.io /v1/enrichment/profile with LinkedIn URL
    -> Return: structured profile (name, title, company, experience, education, skills)
  -> Brain summarizes for user
```

## Skill Definition

**Name:** `people`
**Display name:** People Research
**No auth required** — server-side API keys (SCRAPIN_API_KEY, DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD)

### Actions

#### research_person
Search for a person by name and company/domain. Uses DataForSEO to find LinkedIn URL, then Scrapin.io for profile data.

Parameters:
- `name` (string, required) — Person's name (first, last, or full)
- `company_or_domain` (string, required) — Company name or domain to narrow the search

Returns: name, headline, title, company, location, experience history, education, skills, LinkedIn URL

#### lookup_profile
Direct LinkedIn profile lookup when user already has a URL.

Parameters:
- `linkedin_url` (string, required) — Full LinkedIn profile URL

Returns: same as research_person

#### find_email
Find verified email addresses for a person.

Parameters:
- `first_name` (string, required)
- `last_name` (string, required)
- `company_name` (string, required)

Returns: list of validated emails with type (professional/personal)

#### research_company
Look up company information from a domain.

Parameters:
- `domain` (string, required) — Company website domain

Returns: company name, industry, size, headquarters, description, LinkedIn URL

## API Details

### DataForSEO
- **Endpoint:** `POST https://api.dataforseo.com/v3/serp/google/organic/live/regular`
- **Auth:** Basic auth (login:password)
- **Request:** `[{"language_code":"en","location_code":2840,"keyword":"site:linkedin.com/in <name> <company>","depth":5}]`
- **Cost:** ~$0.01-0.02 per search

### Scrapin.io
- **Profile:** `POST https://api.scrapin.io/v1/enrichment/profile?apikey=KEY`
  - Body: `{"linkedInUrl":"...","cacheDuration":"1w","includes":{"includeCompany":true,"includeSummary":true,"includeExperience":true,"includeEducation":true,"includeSkills":true}}`
  - Cost: 1 credit (0.5 cached)
- **Email finder:** `POST https://api.scrapin.io/v1/enrichment/emails/finder?apikey=KEY`
  - Body: `{"firstName":"...","lastName":"...","companyName":"..."}`
  - Cost: 2 credits (only charged if results found)
- **Company:** `GET https://api.scrapin.io/v1/enrichment/company/domain?apikey=KEY&domain=...`
  - Cost: 1 credit (0.5 cached)

## Architecture

- Handler: `packages/skills/src/people/handler.ts`
- Definition added to `packages/skills/src/registry.ts`
- No OAuth — uses env vars: `SCRAPIN_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`
- Registered in `message-handler.ts` unconditionally (like the babji skill)
- Uses `cacheDuration: "1w"` on Scrapin.io calls to reduce costs on repeated lookups

## Error Handling

- DataForSEO returns no LinkedIn results -> return "Could not find a LinkedIn profile for that person"
- Scrapin.io profile returns 404 -> return "LinkedIn profile exists but could not be scraped"
- API errors -> wrap with descriptive error message, don't expose raw API errors
- Rate limits -> log and return user-friendly message

## Credits

- `research_person`: 1 credit (covers DataForSEO + Scrapin.io)
- `lookup_profile`: 1 credit
- `find_email`: 2 credits
- `research_company`: 1 credit
