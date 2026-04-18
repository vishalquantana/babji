export default function TermsAndConditions() {
  return (
    <main className="min-h-screen px-6 py-20 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-text-primary mb-2">Terms and Conditions</h1>
      <p className="text-text-secondary mb-10">Last updated: March 19, 2026</p>

      <div className="space-y-8 text-text-primary leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
          <p>
            By using Babji (&ldquo;the Service&rdquo;), operated by Quantana (&ldquo;we&rdquo;, &ldquo;us&rdquo;),
            you agree to be bound by these Terms and Conditions. If you do not agree, please do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
          <p>
            Babji is an AI-powered business assistant that operates through Telegram. It helps you manage
            emails, calendar, social media, advertising, project management, and other business tools
            through natural language conversation.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. AI Limitations and Disclaimer</h2>
          <p>
            Babji is powered by artificial intelligence and may produce inaccurate, incomplete, or
            inappropriate responses. <strong>Babji and Quantana are not responsible for any actions
            taken by the AI on your behalf.</strong> This includes but is not limited to:
          </p>
          <ul className="list-disc ml-6 mt-2 space-y-1">
            <li>Emails sent or drafted incorrectly</li>
            <li>Calendar events scheduled at wrong times</li>
            <li>Social media posts published with errors</li>
            <li>Incorrect information provided in research or summaries</li>
            <li>Any financial decisions made based on AI-generated reports</li>
          </ul>
          <p className="mt-3">
            You are solely responsible for reviewing and approving any actions before they are executed.
            We strongly recommend reviewing drafts and scheduled actions before they go live.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. Connected Services and Data Risk</h2>
          <p>
            When you connect third-party services (Gmail, Google Calendar, Google Ads, LinkedIn, Jira,
            Instagram, Facebook, etc.) to Babji, you do so at your own risk.{" "}
            <strong>Babji and Quantana are not responsible for any data loss, corruption, unauthorized
            access, or other damages</strong> resulting from the use of connected services, including
            but not limited to:
          </p>
          <ul className="list-disc ml-6 mt-2 space-y-1">
            <li>Loss or modification of emails, calendar events, or files</li>
            <li>Unintended social media posts or ad campaign changes</li>
            <li>Exposure of sensitive information through connected accounts</li>
            <li>Service disruptions or downtime of connected platforms</li>
            <li>Token expiration or revocation affecting service functionality</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. No Warranty</h2>
          <p>
            The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties
            of any kind, whether express or implied. We do not guarantee that the Service will be
            uninterrupted, error-free, or secure. We make no warranties regarding the accuracy or
            reliability of any information provided by the AI.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by law, Babji and Quantana shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages, including but not limited
            to loss of profits, data, business opportunities, or goodwill, arising from your use of
            the Service or any connected services.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. User Responsibilities</h2>
          <p>You agree to:</p>
          <ul className="list-disc ml-6 mt-2 space-y-1">
            <li>Use the Service in compliance with all applicable laws</li>
            <li>Not use the Service for any illegal or unauthorized purpose</li>
            <li>Review AI-generated content before it is sent or published</li>
            <li>Maintain the security of your connected accounts</li>
            <li>Promptly report any unauthorized access or security issues</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. Service Availability</h2>
          <p>
            We reserve the right to modify, suspend, or discontinue the Service at any time without
            notice. We are not liable for any modification, suspension, or discontinuation of the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. Data Deletion</h2>
          <p>
            You may request complete deletion of your data at any time by messaging Babji or contacting
            us at the email below. See our{" "}
            <a href="/privacy" className="text-accent hover:underline">Privacy Policy</a>{" "}
            for full details on data handling.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">10. Changes to Terms</h2>
          <p>
            We may update these terms from time to time. Continued use of the Service after changes
            constitutes acceptance of the updated terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">11. Contact</h2>
          <p>
            For questions about these terms, contact us at:{" "}
            <a href="mailto:legal@quantana.top" className="text-accent hover:underline">
              legal@quantana.top
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
