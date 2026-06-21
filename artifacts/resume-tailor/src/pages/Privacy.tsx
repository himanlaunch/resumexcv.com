import { Link } from "wouter";
import { BrandLogo } from "@/components/BrandLogo";

export default function Privacy() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F2F4F5" }}>
      {/* Nav */}
      <nav className="sticky top-0 z-50 px-6 py-4 flex items-center justify-between" style={{ backgroundColor: "#0A0A0A", borderBottom: "1px solid #1a1a1a" }}>
        <Link href="/">
          <BrandLogo onDark imageClassName="h-8" />
        </Link>
        <Link href="/" className="text-sm font-medium" style={{ color: "#aaa" }}>← Back to home</Link>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="font-heading font-bold text-3xl mb-2" style={{ color: "#0A0A0A" }}>Privacy Policy</h1>
        <p className="text-sm mb-10" style={{ color: "#888" }}>Last updated: June 21, 2025</p>

        <div className="space-y-8 text-sm leading-relaxed" style={{ color: "#333" }}>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>1. Who We Are</h2>
            <p>ResumeX100 ("we", "us", "our") operates the website resumexcv.com and provides AI-powered resume tailoring services. If you have questions about this policy, contact us at <a href="mailto:hello@resumexcv.com" style={{ color: "#00c447" }}>hello@resumexcv.com</a>.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>2. Information We Collect</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Account information:</strong> Email address and name when you sign up via email OTP or Google OAuth.</li>
              <li><strong>Resume content:</strong> The resume files you upload (PDF, DOCX, TXT) and the structured data we extract from them.</li>
              <li><strong>Job data:</strong> Job descriptions and postings you search for or paste into the app.</li>
              <li><strong>Generated resumes:</strong> Tailored resume versions created by the AI, which we store so you can access them later.</li>
              <li><strong>Usage data:</strong> Pages visited, features used, and timestamps — collected via server logs.</li>
              <li><strong>Payment information:</strong> Handled entirely by Stripe. We never see or store your card details.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>To provide, maintain, and improve the resume tailoring service.</li>
              <li>To process payments and manage your credit balance.</li>
              <li>To send transactional emails (OTP codes, receipts). We do not send marketing emails without your consent.</li>
              <li>To detect and prevent abuse and fraud.</li>
              <li>To improve AI output quality — we may use anonymised resume content to evaluate and improve our models.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>4. AI Processing</h2>
            <p>Your resume content is sent to Azure OpenAI (Microsoft) for parsing and tailoring. Azure OpenAI does not use your data to train its models by default under Microsoft's enterprise data protection commitments. Job search data is fetched via SerpAPI.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>5. Data Sharing</h2>
            <p>We do not sell your personal data. We share data only with:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong>Supabase</strong> — authentication and database hosting.</li>
              <li><strong>Azure OpenAI (Microsoft)</strong> — AI processing of resume content.</li>
              <li><strong>Stripe</strong> — payment processing.</li>
              <li><strong>SerpAPI</strong> — job search queries (we do not send personal data, only job title and location).</li>
              <li><strong>Vercel</strong> — web hosting and serverless infrastructure.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>6. Data Retention</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Your account and resume data are retained while your account is active.</li>
              <li>Shared resume links expire after 7 days.</li>
              <li>Cached parse and tailoring results are retained for up to 48 hours.</li>
              <li>You may delete your account and all associated data at any time by emailing <a href="mailto:hello@resumexcv.com" style={{ color: "#00c447" }}>hello@resumexcv.com</a>.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>7. Your Rights</h2>
            <p>Depending on your location, you may have the right to access, correct, port, or delete your personal data. To exercise any of these rights, email <a href="mailto:hello@resumexcv.com" style={{ color: "#00c447" }}>hello@resumexcv.com</a>. We will respond within 30 days.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>8. Cookies</h2>
            <p>We use only essential cookies required for authentication (Supabase session token). We do not use advertising or tracking cookies.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>9. Security</h2>
            <p>All data is transmitted over HTTPS. Database access is restricted to authenticated server-side processes. We follow industry-standard security practices and review them regularly.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>10. Children</h2>
            <p>This service is not directed at children under 16. We do not knowingly collect data from anyone under 16.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>11. Changes to This Policy</h2>
            <p>We may update this policy from time to time. We will notify you of material changes by updating the "Last updated" date above. Continued use of the service after changes constitutes acceptance.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>12. Contact</h2>
            <p>Email us at <a href="mailto:hello@resumexcv.com" style={{ color: "#00c447" }}>hello@resumexcv.com</a> for any privacy-related questions or requests.</p>
          </section>

        </div>
      </div>

      <footer className="py-8 px-6 text-center text-xs" style={{ backgroundColor: "#0A0A0A", color: "#444" }}>
        <p>© 2025 ResumeX100. All rights reserved. · <Link href="/privacy" style={{ color: "#666" }}>Privacy</Link> · <Link href="/terms" style={{ color: "#666" }}>Terms</Link></p>
      </footer>
    </div>
  );
}
