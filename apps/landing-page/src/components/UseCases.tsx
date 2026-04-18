const examples = [
  {
    user: "Draft a follow-up email to Sarah about the proposal",
    babji: "Done! I've created a draft in your Gmail. It references your last conversation about the Q2 budget proposal. Want me to send it?",
  },
  {
    user: "Schedule an Instagram post for tomorrow 9am",
    babji: "Post scheduled for tomorrow at 9:00 AM. I've included the image you generated earlier with relevant hashtags.",
  },
  {
    user: "What's my ad spend this week?",
    babji: "Your Google Ads spend this week: $342.50 across 3 campaigns. 'Summer Sale' is performing best with a 4.2% CTR.",
  },
  {
    user: "Create a Jira ticket for the login bug",
    babji: "Created BAB-58: 'Login page returns 500 on mobile Safari'. Assigned to you, priority High. I added the error details from your last message.",
  },
  {
    user: "Clear my morning — reschedule anything before 11am",
    babji: "Moved 2 meetings: standup pushed to 11:30 AM, and the vendor call to 2 PM tomorrow. Your morning is free until 11.",
  },
  {
    user: "Check who viewed my LinkedIn post",
    babji: "Your latest post got 1,247 views and 23 reactions. Top viewers include 3 CTOs and a VP of Marketing from enterprise companies.",
  },
];

export default function UseCases() {
  return (
    <section className="px-6 py-24 bg-white">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-center text-text-primary mb-4">
          See what Babji can do
        </h2>
        <p className="text-text-secondary text-center mb-16 text-lg">
          Real examples of everyday tasks handled in seconds.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {examples.map((ex, i) => (
            <div key={i} className="rounded-2xl border border-gray-100 p-6 space-y-3 shadow-sm">
              {/* User message */}
              <div className="flex justify-end">
                <div className="bg-accent text-white px-4 py-2.5 rounded-2xl rounded-br-md text-sm max-w-[85%] text-left">
                  {ex.user}
                </div>
              </div>
              {/* Babji response */}
              <div className="flex justify-start">
                <div className="bg-gray-50 text-text-primary px-4 py-2.5 rounded-2xl rounded-bl-md text-sm max-w-[90%] text-left">
                  <span className="font-medium text-accent text-xs block mb-1">Babji</span>
                  {ex.babji}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
