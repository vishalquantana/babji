import { Mail, Calendar, BarChart3, TrendingUp, Linkedin, Trello, Instagram, Facebook } from "lucide-react";

const integrations = [
  { name: "Gmail", icon: Mail, color: "#EA4335" },
  { name: "Calendar", icon: Calendar, color: "#4285F4" },
  { name: "Google Ads", icon: BarChart3, color: "#FBBC04" },
  { name: "Analytics", icon: TrendingUp, color: "#34A853" },
  { name: "LinkedIn", icon: Linkedin, color: "#0A66C2" },
  { name: "Jira", icon: Trello, color: "#0052CC" },
  { name: "Instagram", icon: Instagram, color: "#E4405F" },
  { name: "Facebook", icon: Facebook, color: "#1877F2" },
];

export default function Integrations() {
  return (
    <section className="px-6 py-24">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-center text-text-primary mb-4">
          Connects to the tools you already use
        </h2>
        <p className="text-text-secondary text-center mb-16 text-lg">
          One-click setup. No APIs or code required.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto">
          {integrations.map((item) => (
            <div
              key={item.name}
              className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${item.color}15` }}
              >
                <item.icon size={24} style={{ color: item.color }} />
              </div>
              <span className="text-sm font-medium text-text-primary">{item.name}</span>
            </div>
          ))}
        </div>

        <p className="text-center text-text-secondary text-sm mt-8">
          More integrations coming soon
        </p>
      </div>
    </section>
  );
}
