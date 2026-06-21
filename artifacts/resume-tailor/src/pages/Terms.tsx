import { Link } from "wouter";
import { BrandLogo } from "@/components/BrandLogo";

export default function Terms() {
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
        <h1 className="font-heading font-bold text-3xl mb-2" style={{ color: "#0A0A0A" }}>Terms of Service</h1>
        <p className="text-sm mb-10" style={{ color: "#888" }}>Last updated: June 21, 2025</p>

        <div className="space-y-8 text-sm leading-relaxed" style={{ color: "#333" }}>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>1. Acceptance of Terms</h2>
            <p>By accessing or using ResumeX100 at resumexcv.com ("Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>2. Description of Service</h2>
            <p>ResumeX100 is an AI-powered resume tailoring platform. It helps users customise their resumes for specific job postings using large language models. The Service is provided "as is" for professional productivity purposes.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>3. Eligibility</h2>
            <p>You must be at least 16 years old to use this Service. By using the Service you represent that you meet this requirement.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>4. User Accounts</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>You are responsible for maintaining the security of your account credentials.</li>
              <li>You must provide accurate information when creating an account.</li>
              <li>You are responsible for all activity that occurs under your account.</li>
              <li>You may not share your account with others or create multiple accounts to circumvent credit limits.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>5. Credits and Payments</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>New accounts receive 10 free resume credits upon signup.</li>
              <li>Each successful resume tailoring operation consumes one credit.</li>
              <li>Additional credits may be purchased through our Stripe-powered checkout.</li>
              <li>Credits are non-refundable except where required by law. Unused credits do not expire.</li>
              <li>Credits are not transferable between accounts.</li>
              <li>We reserve the right to change pricing with reasonable notice.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>6. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Use the Service to generate false, misleading, or fraudulent resume content.</li>
              <li>Attempt to circumvent rate limits, credit systems, or authentication.</li>
              <li>Reverse engineer, scrape, or automate the Service without prior written consent.</li>
              <li>Use the Service for any unlawful purpose or in violation of any applicable regulations.</li>
              <li>Upload files containing malware, viruses, or malicious code.</li>
              <li>Resell or sublicense access to the Service.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>7. AI-Generated Content</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>AI-generated resume content is a suggestion for you to review and edit. You are solely responsible for reviewing all AI output before using it in a job application.</li>
              <li>We do not guarantee the accuracy, completeness, or fitness of AI-generated content for any particular job application.</li>
              <li>You own the final resume content you create using the Service.</li>
              <li>Do not include any information in your resume that is inaccurate or that you cannot substantiate in an interview.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>8. Intellectual Property</h2>
            <p>The ResumeX100 platform, brand, and codebase are owned by us. You retain ownership of the resume content you upload. You grant us a limited licence to process your content solely to provide the Service to you.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>9. Disclaimers</h2>
            <p>The Service is provided "as is" without warranties of any kind, express or implied. We do not warrant that:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>The Service will be uninterrupted or error-free.</li>
              <li>AI-generated content will be suitable for any specific job application.</li>
              <li>Job search results will be accurate or up to date.</li>
              <li>Use of the Service will result in employment.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>10. Limitation of Liability</h2>
            <p>To the maximum extent permitted by applicable law, ResumeX100 shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service, including but not limited to loss of employment opportunities. Our total liability to you shall not exceed the amount you paid us in the 12 months preceding the claim.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>11. Termination</h2>
            <p>We reserve the right to suspend or terminate your account at any time for violation of these Terms. You may delete your account at any time by emailing <a href="mailto:hello@resumexcv.com" style={{ color: "#00c447" }}>hello@resumexcv.com</a>.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>12. Changes to Terms</h2>
            <p>We may modify these Terms at any time. We will notify you of material changes by updating the "Last updated" date. Continued use of the Service after changes constitutes your acceptance of the new Terms.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>13. Governing Law</h2>
            <p>These Terms are governed by the laws of Ireland. Any disputes shall be subject to the exclusive jurisdiction of the courts of Ireland.</p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-3" style={{ color: "#0A0A0A" }}>14. Contact</h2>
            <p>For any questions about these Terms, email <a href="mailto:hello@resumexcv.com" style={{ color: "#00c447" }}>hello@resumexcv.com</a>.</p>
          </section>

        </div>
      </div>

      <footer className="py-8 px-6 text-center text-xs" style={{ backgroundColor: "#0A0A0A", color: "#444" }}>
        <p>© 2025 ResumeX100. All rights reserved. · <Link href="/privacy" style={{ color: "#666" }}>Privacy</Link> · <Link href="/terms" style={{ color: "#666" }}>Terms</Link></p>
      </footer>
    </div>
  );
}
