import { MessageCircle, Link, Sparkles } from "lucide-react";

const steps = [
  {
    icon: MessageCircle,
    title: "Message Babji",
    description: "Open Telegram and start a conversation. No apps to install, no accounts to create.",
  },
  {
    icon: Link,
    title: "Connect your tools",
    description: "Link Gmail, Calendar, Google Ads, LinkedIn, and more with one-click OAuth.",
  },
  {
    icon: Sparkles,
    title: "Just ask",
    description: "Tell Babji what you need in plain English. It understands context and gets things done.",
  },
];

export default function HowItWorks() {
  return (
    <section className="px-6 py-24 bg-white">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-center text-text-primary mb-4">
          How it works
        </h2>
        <p className="text-text-secondary text-center mb-16 text-lg">
          Three steps. That&apos;s it.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <div key={i} className="text-center px-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-light text-accent mb-6">
                <step.icon size={28} />
              </div>
              <div className="text-sm font-semibold text-accent mb-2">Step {i + 1}</div>
              <h3 className="text-xl font-bold text-text-primary mb-3">{step.title}</h3>
              <p className="text-text-secondary leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
