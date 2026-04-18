# Babji Landing Page Redesign

## Goal

Redesign the Babji landing page (babji.quantana.top) to drive direct onboarding (start using Babji on Telegram) while building credibility and trust. Target audience: small business owners and tech-savvy startup founders.

## Visual Style

- **Palette:** Warm & approachable — cream background (#FDF8F5), orange accent (#FF6B35), dark text (#2D2D2D), soft grays for secondary text
- **Typography:** Inter (or system sans-serif fallback), large hero text, clean body copy
- **Shape language:** Rounded corners (12-16px), soft shadows, generous whitespace
- **Mood:** Friendly, trustworthy, simple — think Notion/Calm, not Linear/Vercel
- **No Three.js or WebGL** — pure CSS animations only (removes crash risk from current version)

## Sections

### 1. Hero with CTA
- Headline: "Your AI business assistant, on Telegram"
- Subtitle: "Just tell Babji what you need — emails, calendar, ads, social media — and it handles the rest."
- Primary CTA: "Start on Telegram" button (links to t.me/babji_bot)
- Visual: Hardcoded JSX component with two styled div bubbles (user message + Babji response), no dynamic data or images needed
- Subtle CSS gradient animation on background (slow `background-position` shift using `@keyframes`, 8s cycle, warm cream to light peach)
- Telegram bot link: `https://t.me/AskBabjiBot` (used in both Hero and Footer CTAs)

### 2. How It Works
- 3-step horizontal layout (stacks vertically on mobile)
- Step 1: "Message Babji on Telegram" — chat icon
- Step 2: "Connect your tools" — link/chain icon, mention Gmail, Calendar, etc.
- Step 3: "Just ask" — sparkle/magic icon, "It handles the rest"
- Each step: icon, title, one-line description

### 3. Integrations
- Section title: "Connects to the tools you already use"
- Logo grid showing: Gmail, Google Calendar, Google Ads, Google Analytics, LinkedIn, Jira, Instagram, Facebook
- Warm-toned badges/pills with inline SVG icons (use `simple-icons` npm package or hand-crafted SVGs in components — no external CDN or image files)
- "More coming soon" note

### 4. Use Cases / Examples
- 4-6 cards showing real Babji commands and results:
  - "Draft a follow-up email to Sarah" → shows draft created
  - "Schedule an Instagram post for tomorrow 9am" → shows scheduled confirmation
  - "What's my ad spend this week?" → shows summary numbers
  - "Create a Jira ticket for the login bug" → shows ticket created
  - "Clear my morning — reschedule anything before 11am" → shows calendar update
  - "Check who viewed my LinkedIn post" → shows analytics
- Each card: user message bubble + Babji response bubble (chat-style)

### 5. Testimonials / Social Proof
- 2-3 testimonial cards with quote, name, role
- Placeholder content for now (can be replaced with real testimonials later)
- Stats row omitted for now (add later when real numbers are available)

### 6. Pricing
- Single card: "Free during beta"
- Brief description: "Babji is free while we're in beta. We'll introduce paid plans later with generous free tiers."
- CTA: "Start for free" button

### 7. FAQ
- Accordion-style (click to expand)
- Questions:
  - "Is my data safe?" → Encrypted storage, OAuth tokens, no passwords stored
  - "Which platforms does it work on?" → Telegram now, WhatsApp coming soon
  - "Do I need to install anything?" → No, just message on Telegram
  - "How much does it cost?" → Free during beta
  - "What can Babji do?" → Brief list of capabilities
- Only interactive component on the page (client-side JS for accordion toggle)

### 8. Footer
- Final CTA: "Ready to get started?" + "Start on Telegram" button
- Links: Privacy, Terms (can be placeholder)
- Copyright: "© 2026 Quantana"
- Minimal, clean

## Technical Approach

### Stack
- Next.js 15 (existing app at `apps/landing-page/`)
- Tailwind CSS (already configured)
- React Server Components where possible
- Single `"use client"` component for FAQ accordion

### File Structure
- `src/app/page.tsx` — page composition (server component)
- `src/app/layout.tsx` — root layout, fonts, metadata
- `src/components/Hero.tsx` — hero section (server component)
- `src/components/HowItWorks.tsx` — 3-step flow (server component)
- `src/components/Integrations.tsx` — logo grid (server component)
- `src/components/UseCases.tsx` — example cards (server component)
- `src/components/Testimonials.tsx` — social proof (server component)
- `src/components/Pricing.tsx` — pricing card (server component)
- `src/components/FAQ.tsx` — accordion (client component)
- `src/components/Footer.tsx` — footer with CTA (server component)

### Removed
- `ThreeCore.tsx` — deleted (WebGL crash source)
- `PillarsSection.tsx` — replaced by HowItWorks
- `JuiceEconomy.tsx` — replaced by Pricing
- `SkillsLearningSection.tsx` — replaced by UseCases

### Performance
- Static export (no server-side rendering needed; `"use client"` for FAQ accordion is compatible with static export)
- No heavy JS dependencies (Three.js removed)
- System font stack with Inter as primary
- Optimized images via Next.js Image component where needed

### Responsive
- Mobile-first design
- Hero stacks vertically on mobile
- How It Works cards stack on mobile
- Integration grid wraps naturally
- Use case cards single column on mobile

## Out of Scope
- User authentication / login on landing page
- Blog / content pages
- Analytics integration (can be added separately)
- Dark mode toggle
