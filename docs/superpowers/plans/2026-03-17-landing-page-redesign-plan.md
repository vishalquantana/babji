# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Babji landing page with warm/approachable style, 8 sections, direct Telegram onboarding CTA.

**Architecture:** Replace all existing components with new ones. Drop Three.js entirely. Pure Tailwind CSS with server components (except FAQ accordion). Static export.

**Tech Stack:** Next.js 15, Tailwind CSS v4, lucide-react for icons, Inter font (already configured)

**Spec:** `docs/superpowers/specs/2026-03-17-landing-page-redesign-design.md`

---

## Task 1: Clean up — remove old components and Three.js deps

**Files:**
- Delete: `apps/landing-page/src/components/ThreeCore.tsx`
- Delete: `apps/landing-page/src/components/PillarsSection.tsx`
- Delete: `apps/landing-page/src/components/JuiceEconomy.tsx`
- Delete: `apps/landing-page/src/components/SkillsLearningSection.tsx`
- Delete: `apps/landing-page/src/components/HeroSection.tsx`
- Delete: `apps/landing-page/src/components/UseCasesSection.tsx`
- Delete: `apps/landing-page/src/components/Footer.tsx`
- Modify: `apps/landing-page/package.json` — remove three, @react-three/fiber, @react-three/drei, @types/three, gsap, lottie-react

- [ ] **Step 1:** Delete all old component files
- [ ] **Step 2:** Remove Three.js and unused deps from package.json
- [ ] **Step 3:** Run `pnpm install` to update lockfile
- [ ] **Step 4:** Commit: "chore: remove old landing page components and Three.js deps"

## Task 2: Update layout.tsx and globals.css

**Files:**
- Modify: `apps/landing-page/src/app/layout.tsx`
- Modify: `apps/landing-page/src/app/globals.css`

- [ ] **Step 1:** Update layout.tsx — simplify fonts to Inter only, update metadata title/description, set warm background color
- [ ] **Step 2:** Update globals.css — set CSS custom properties for warm palette (#FDF8F5 bg, #FF6B35 accent, #2D2D2D text)
- [ ] **Step 3:** Verify build: `pnpm --filter landing-page build`
- [ ] **Step 4:** Commit: "style: update layout with warm palette and simplified fonts"

## Task 3: Hero section

**Files:**
- Create: `apps/landing-page/src/components/Hero.tsx`
- Modify: `apps/landing-page/src/app/page.tsx`

- [ ] **Step 1:** Create Hero.tsx — headline, subtitle, "Start on Telegram" CTA button (links to https://t.me/AskBabjiBot), mock chat bubble with hardcoded user/Babji messages, subtle CSS gradient animation
- [ ] **Step 2:** Update page.tsx to import only Hero for now
- [ ] **Step 3:** Verify: `pnpm --filter landing-page dev`, check localhost:3000
- [ ] **Step 4:** Commit: "feat: add hero section with chat preview and Telegram CTA"

## Task 4: How It Works section

**Files:**
- Create: `apps/landing-page/src/components/HowItWorks.tsx`
- Modify: `apps/landing-page/src/app/page.tsx`

- [ ] **Step 1:** Create HowItWorks.tsx — 3-step horizontal cards (MessageCircle, Link, Sparkles icons from lucide-react), stacks on mobile
- [ ] **Step 2:** Add to page.tsx
- [ ] **Step 3:** Verify visually
- [ ] **Step 4:** Commit: "feat: add how-it-works section"

## Task 5: Integrations section

**Files:**
- Create: `apps/landing-page/src/components/Integrations.tsx`
- Modify: `apps/landing-page/src/app/page.tsx`

- [ ] **Step 1:** Create Integrations.tsx — "Connects to the tools you already use" heading, grid of 8 service badges (Gmail, Calendar, Google Ads, Analytics, LinkedIn, Jira, Instagram, Facebook) using inline SVG icons or lucide-react where available, warm-toned pills
- [ ] **Step 2:** Add to page.tsx
- [ ] **Step 3:** Verify visually
- [ ] **Step 4:** Commit: "feat: add integrations grid section"

## Task 6: Use Cases section

**Files:**
- Create: `apps/landing-page/src/components/UseCases.tsx`
- Modify: `apps/landing-page/src/app/page.tsx`

- [ ] **Step 1:** Create UseCases.tsx — 6 chat-style cards showing user command + Babji response. Cards in 2-column grid (1 column on mobile).
- [ ] **Step 2:** Add to page.tsx
- [ ] **Step 3:** Verify visually
- [ ] **Step 4:** Commit: "feat: add use cases section with chat examples"

## Task 7: Testimonials section

**Files:**
- Create: `apps/landing-page/src/components/Testimonials.tsx`
- Modify: `apps/landing-page/src/app/page.tsx`

- [ ] **Step 1:** Create Testimonials.tsx — 3 testimonial cards with placeholder quotes, names, roles. Clean card layout.
- [ ] **Step 2:** Add to page.tsx
- [ ] **Step 3:** Verify visually
- [ ] **Step 4:** Commit: "feat: add testimonials section"

## Task 8: Pricing section

**Files:**
- Create: `apps/landing-page/src/components/Pricing.tsx`
- Modify: `apps/landing-page/src/app/page.tsx`

- [ ] **Step 1:** Create Pricing.tsx — single "Free during beta" card with description and "Start for free" CTA button
- [ ] **Step 2:** Add to page.tsx
- [ ] **Step 3:** Verify visually
- [ ] **Step 4:** Commit: "feat: add pricing section"

## Task 9: FAQ section (client component)

**Files:**
- Create: `apps/landing-page/src/components/FAQ.tsx`
- Modify: `apps/landing-page/src/app/page.tsx`

- [ ] **Step 1:** Create FAQ.tsx with "use client" — accordion with 5 questions, useState for open/close toggle, ChevronDown icon from lucide-react
- [ ] **Step 2:** Add to page.tsx
- [ ] **Step 3:** Verify accordion works in browser
- [ ] **Step 4:** Commit: "feat: add FAQ accordion section"

## Task 10: Footer section

**Files:**
- Create: `apps/landing-page/src/components/Footer.tsx`
- Modify: `apps/landing-page/src/app/page.tsx`

- [ ] **Step 1:** Create Footer.tsx — final CTA "Ready to get started?" + "Start on Telegram" button, copyright "© 2026 Quantana", placeholder privacy/terms links
- [ ] **Step 2:** Add to page.tsx, finalize section order in page
- [ ] **Step 3:** Full visual review of complete page
- [ ] **Step 4:** Commit: "feat: add footer with final CTA"

## Task 11: Build, deploy, verify

- [ ] **Step 1:** Run `pnpm --filter landing-page build` — verify static export succeeds
- [ ] **Step 2:** Rsync to server, rebuild on server, restart PM2
- [ ] **Step 3:** Verify https://babji.quantana.top loads correctly
- [ ] **Step 4:** Commit any final fixes
