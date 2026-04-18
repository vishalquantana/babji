import { Check, Send } from "lucide-react";

const TELEGRAM_URL = "https://t.me/AskBabjiBot";

const features = [
  "Unlimited messages",
  "Gmail, Calendar, Google Ads",
  "LinkedIn, Instagram, Facebook",
  "Jira integration",
  "Daily briefings",
  "Memory that learns your preferences",
];

export default function Pricing() {
  return (
    <section className="px-6 py-24 bg-white">
      <div className="max-w-lg mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">
          Free during beta
        </h2>
        <p className="text-text-secondary mb-12 text-lg">
          Try everything Babji can do — no credit card, no commitment.
        </p>

        <div className="bg-warm-bg rounded-2xl border-2 border-accent p-8 shadow-lg">
          <div className="text-5xl font-bold text-text-primary mb-2">$0</div>
          <div className="text-text-secondary mb-8">Free while we&apos;re in beta</div>

          <ul className="space-y-3 text-left mb-8">
            {features.map((f) => (
              <li key={f} className="flex items-center gap-3">
                <Check size={18} className="text-accent flex-shrink-0" />
                <span className="text-text-primary">{f}</span>
              </li>
            ))}
          </ul>

          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 w-full px-8 py-4 bg-accent hover:bg-accent-dark text-white font-semibold rounded-2xl text-lg transition-all duration-200"
          >
            <Send size={20} />
            Start for free
          </a>
        </div>
      </div>
    </section>
  );
}
