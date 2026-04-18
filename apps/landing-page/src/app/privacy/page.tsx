export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen px-6 py-20 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-text-primary mb-2">Privacy Policy</h1>
      <p className="text-text-secondary mb-10">Last updated: March 19, 2026</p>

      <div className="space-y-8 text-text-primary leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. Who We Are</h2>
          <p>
            Babji is an AI business assistant operated by Quantana (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
            Babji helps you manage emails, calendar, social media, and other business tools through a conversational
            interface on Telegram.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. What Data We Collect</h2>
          <p>When you use Babji, we may collect:</p>
          <ul className="list-disc ml-6 mt-2 space-y-1">
            <li>Your Telegram user ID and display name</li>
            <li>Messages you send to Babji (chat history)</li>
            <li>OAuth tokens for connected services (Gmail, Calendar, Google Ads, LinkedIn, Jira, etc.)</li>
            <li>Preferences, timezone, and memory notes extracted from conversations</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. How We Use Your Data</h2>
          <p>We use your data solely to:</p>
          <ul className="list-disc ml-6 mt-2 space-y-1">
            <li>Provide the Babji assistant service to you</li>
            <li>Execute actions on your behalf (sending emails, scheduling posts, etc.)</li>
            <li>Remember your preferences and past conversations for better assistance</li>
            <li>Debug issues and resolve technical problems with the service</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. We Do Not Share Your Data</h2>
          <p>
            We do not sell, rent, or share your personal data with any third parties. Your data stays between
            you and Babji. The only external services that receive your data are the ones you explicitly connect
            (e.g., when you ask Babji to send an email, that email is sent via your own Gmail account).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Data Security</h2>
          <p>
            All OAuth tokens are encrypted using AES-256-GCM encryption. We never store your passwords.
            Your data is isolated per user and stored on encrypted servers. Access to production systems
            is restricted to authorized personnel only.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Data Retention and Deletion</h2>
          <p>
            We retain your data for as long as you use the service. You may request complete deletion
            of all your data at any time by messaging Babji or contacting us at the email below.
            Upon receiving a deletion request, we will remove all your personal data, chat history,
            memory notes, and stored credentials within 30 days.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. Chat Data for Debugging</h2>
          <p>
            We may access your chat data to diagnose and resolve technical issues with the service.
            This access is limited to what is necessary for debugging purposes and is only performed
            by authorized team members.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. Third-Party Services</h2>
          <p>
            Babji integrates with third-party services (Google, LinkedIn, Atlassian, Meta) through
            their official APIs using OAuth. We only request the permissions necessary to provide
            the features you use. You can revoke access to any connected service at any time through
            that service&apos;s settings or by asking Babji.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. Changes to This Policy</h2>
          <p>
            We may update this privacy policy from time to time. We will notify you of significant
            changes through the Babji chat interface.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">10. Contact</h2>
          <p>
            For privacy-related questions or data deletion requests, contact us at:{" "}
            <a href="mailto:privacy@quantana.top" className="text-accent hover:underline">
              privacy@quantana.top
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
