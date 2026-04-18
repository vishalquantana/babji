import { Send } from "lucide-react";

const TELEGRAM_URL = "https://t.me/AskBabjiBot";

export default function Footer() {
  return (
    <footer className="px-6 py-24 bg-[#2D2D2D] text-white">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4">
          Ready to get started?
        </h2>
        <p className="text-gray-300 text-lg mb-10">
          Message Babji on Telegram and see what it can do for your business.
        </p>

        <a
          href={TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-8 py-4 bg-accent hover:bg-accent-dark text-white font-semibold rounded-2xl text-lg transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          <Send size={20} />
          Start on Telegram
        </a>

        <div className="mt-16 pt-8 border-t border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <div>&copy; 2026 Quantana. All rights reserved.</div>
          <div className="flex gap-6">
            <a href="/privacy" className="hover:text-gray-200">Privacy</a>
            <a href="/terms" className="hover:text-gray-200">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
