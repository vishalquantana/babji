import { MessageCircle, Send } from "lucide-react";

const TELEGRAM_URL = "https://t.me/AskBabjiBot";

export default function Hero() {
  return (
    <section className="relative min-h-[90vh] flex flex-col px-6 py-20 overflow-hidden">
      {/* Nav */}
      <nav className="flex items-center justify-between max-w-5xl w-full mx-auto mb-auto">
        <span className="text-xl font-bold text-text-primary">Babji</span>
        <div className="flex items-center gap-6 text-sm text-text-secondary">
          <a href="/privacy" className="hover:text-text-primary transition-colors">Privacy</a>
          <a href="/terms" className="hover:text-text-primary transition-colors">Terms</a>
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent-dark transition-colors"
          >
            Get Started
          </a>
        </div>
      </nav>
      {/* Animated gradient background */}
      <div
        className="absolute inset-0 animate-gradient opacity-60"
        style={{
          background: "linear-gradient(135deg, #FDF8F5 0%, #FFF0E8 25%, #FDF8F5 50%, #FEF3EC 75%, #FDF8F5 100%)",
          backgroundSize: "200% 200%",
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto text-center flex-1 flex flex-col items-center justify-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent-light text-accent text-sm font-medium mb-8">
          <MessageCircle size={16} />
          Available on Telegram
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary leading-tight mb-6">
          Your AI business assistant,{" "}
          <span className="text-accent">on Telegram.</span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto mb-10 leading-relaxed">
          Just tell Babji what you need — emails, calendar, ads, social media — and it handles the rest.
        </p>

        {/* CTA */}
        <a
          href={TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-8 py-4 bg-accent hover:bg-accent-dark text-white font-semibold rounded-2xl text-lg transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5"
        >
          <Send size={20} />
          Start on Telegram
        </a>

        {/* Chat Preview */}
        <div className="mt-16 max-w-md mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4 border border-gray-100">
            {/* User message */}
            <div className="flex justify-end">
              <div className="bg-accent text-white px-4 py-3 rounded-2xl rounded-br-md max-w-[80%] text-sm text-left">
                Check my inbox and summarize what&apos;s urgent
              </div>
            </div>

            {/* Babji response */}
            <div className="flex justify-start">
              <div className="bg-gray-100 text-text-primary px-4 py-3 rounded-2xl rounded-bl-md max-w-[85%] text-sm text-left">
                <p className="font-medium text-accent mb-1">Babji</p>
                You have 3 urgent emails:
                <br />
                <span className="text-text-secondary">1. Invoice from Acme Corp — due today</span>
                <br />
                <span className="text-text-secondary">2. Meeting reschedule from Sarah</span>
                <br />
                <span className="text-text-secondary">3. Google Ads alert — budget exceeded</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
