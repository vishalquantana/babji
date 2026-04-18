"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "Is my data safe?",
    a: "Yes. Your OAuth tokens are encrypted with AES-256-GCM. We never store your passwords. All data is isolated per user and stored on encrypted servers.",
  },
  {
    q: "Which platforms does it work on?",
    a: "Babji works on Telegram right now. WhatsApp support is coming soon. You just message the bot — no app to install.",
  },
  {
    q: "Do I need to install anything?",
    a: "No. Just open Telegram, search for @AskBabjiBot, and start chatting. Babji works entirely through the chat interface.",
  },
  {
    q: "How much does it cost?",
    a: "Babji is completely free during beta. We'll introduce paid plans later with generous free tiers so you can always use the basics at no cost.",
  },
  {
    q: "What can Babji do?",
    a: "Email management, calendar scheduling, Google Ads monitoring, social media posting (LinkedIn, Instagram, Facebook), Jira tickets, contact lookups, research, and more. Just ask!",
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="px-6 py-24">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-center text-text-primary mb-4">
          Frequently asked questions
        </h2>
        <p className="text-text-secondary text-center mb-12 text-lg">
          Everything you need to know.
        </p>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between px-6 py-5 text-left"
              >
                <span className="font-semibold text-text-primary pr-4">{faq.q}</span>
                <ChevronDown
                  size={20}
                  className={`text-text-secondary flex-shrink-0 transition-transform duration-200 ${
                    openIndex === i ? "rotate-180" : ""
                  }`}
                />
              </button>
              {openIndex === i && (
                <div className="px-6 pb-5 text-text-secondary leading-relaxed">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
