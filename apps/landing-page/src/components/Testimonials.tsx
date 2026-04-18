import { Quote } from "lucide-react";

const testimonials = [
  {
    quote: "I used to spend an hour every morning on emails and calendar. Now I just message Babji and it's done before my coffee is ready.",
    name: "Priya M.",
    role: "Freelance Consultant",
  },
  {
    quote: "The Google Ads integration alone saved me from hiring a marketing assistant. Babji checks my campaigns and flags issues automatically.",
    name: "James T.",
    role: "E-commerce Founder",
  },
  {
    quote: "I love that it works on Telegram — no new app to learn. I just talk to it like I'd talk to an assistant and it figures out the rest.",
    name: "Aisha R.",
    role: "Small Business Owner",
  },
];

export default function Testimonials() {
  return (
    <section className="px-6 py-24">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-center text-text-primary mb-4">
          Loved by business owners
        </h2>
        <p className="text-text-secondary text-center mb-16 text-lg">
          Here&apos;s what early users are saying.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {testimonials.map((t, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
              <Quote size={24} className="text-accent opacity-40 mb-4" />
              <p className="text-text-primary leading-relaxed mb-6">{t.quote}</p>
              <div>
                <div className="font-semibold text-text-primary">{t.name}</div>
                <div className="text-sm text-text-secondary">{t.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
