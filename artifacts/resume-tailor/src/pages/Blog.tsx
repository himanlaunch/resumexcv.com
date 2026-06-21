import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, FileText, X, Clock, Calendar } from "lucide-react";

interface Post {
  slug: string;
  title: string;
  subtitle: string;
  readTime: string;
  date: string;
  author: string;
  preview: string;
  body: React.ReactNode;
}

const POSTS: Post[] = [
  {
    slug: "one-resume-not-enough-2025",
    title: "Why One Resume Isn't Enough in 2025 (And What to Do About It)",
    subtitle: "The job market has changed. Your application strategy needs to change with it.",
    readTime: "5 min read",
    date: "May 14, 2025",
    author: "ResumeX100 Team",
    preview: "Sending the same resume to 40 different jobs used to be a reasonable strategy. In 2025, it's the fastest way to get ignored. Here's what's changed — and what to do instead.",
    body: (
      <div className="space-y-5 text-base leading-relaxed" style={{ color: "#444" }}>
        <p>
          Sending the same resume to 40 different jobs used to be a reasonable strategy. In 2025, it's the fastest way to get ignored. Applicant tracking systems have gotten smarter, job descriptions have gotten more specific, and hiring managers have gotten more tired of generic applications. The bar for making it through the first filter — both automated and human — has quietly risen.
        </p>
        <p>
          The core problem is simple: a resume is a pitch, and every job is a different audience. A Product Manager role at a Series B startup cares about shipping speed, customer empathy, and wearing many hats. The same title at a Fortune 500 company cares about stakeholder alignment, roadmap governance, and cross-functional influence. If your resume doesn't speak to those specific concerns, it doesn't matter how qualified you are on paper. You're pitching a hammer to someone shopping for a screwdriver.
        </p>
        <p>
          ATS filters compound this problem. Most large companies now use software to score resumes before a human ever sees them. These systems look for keyword overlap between your resume and the job description. A resume that scores below a threshold gets automatically rejected — regardless of how strong your background is. The keywords that matter for "Senior Data Analyst at a fintech firm" are different from the ones that matter for "Data Analyst at a healthcare startup." One resume can't score well on both without a rewrite.
        </p>
        <p>
          The practical fix isn't to apply to fewer jobs — it's to tailor every application. That sounds overwhelming when you're applying to 30 or 50 roles, but it doesn't have to mean rewriting from scratch. The structure of your resume — your job history, education, core skills — stays the same. What changes is the emphasis: which bullet points you lead with, which keywords appear in your summary, how you describe the same project depending on what the role prioritizes. With the right process (or the right tool), a tailored resume takes minutes, not hours. That's where tools like ResumeX100 come in — letting you generate independently tailored versions of your resume in parallel, one per job, so volume and quality don't have to trade off against each other.
        </p>
        <p>
          The job search landscape in 2025 rewards volume <em>and</em> precision. You don't have to choose between applying widely and applying well. But you do have to stop treating your resume as a static document.
        </p>
      </div>
    ),
  },
  {
    slug: "beat-ats-systems-resume-scanners",
    title: "How to Beat ATS Systems: What Resume Scanners Actually Look For",
    subtitle: "Most ATS advice is vague. Here's the specific, practical version — based on how these systems actually work.",
    readTime: "6 min read",
    date: "May 28, 2025",
    author: "ResumeX100 Team",
    preview: "\"ATS-friendly\" has become a buzzword thrown around without explanation. So let's be specific: what do applicant tracking systems actually parse, score, and filter on?",
    body: (
      <div className="space-y-5 text-base leading-relaxed" style={{ color: "#444" }}>
        <p>
          "ATS-friendly" has become a buzzword thrown around without explanation. You've probably been told to avoid tables, use standard fonts, and include keywords — but the advice usually stops there. So let's be specific: what do applicant tracking systems actually parse, score, and filter on?
        </p>
        <h3 className="font-heading font-bold text-lg mt-6 mb-2" style={{ color: "#0A0A0A" }}>1. Keyword matching is real, but context matters</h3>
        <p>
          Modern ATS platforms (Greenhouse, Lever, Workday, iCIMS) don't just count how many times a keyword appears — they look for relevance and context. If the job description mentions "Python" six times and you mention it once in a skills list buried at the bottom, your score will be lower than a candidate who wove it into three different bullet points describing real work. The fix: mirror the language of the job description. If they say "cross-functional collaboration," don't just say "teamwork." Use the exact phrase.
        </p>
        <h3 className="font-heading font-bold text-lg mt-6 mb-2" style={{ color: "#0A0A0A" }}>2. Formatting breaks parsers more often than you think</h3>
        <p>
          Tables, text boxes, headers/footers, and multi-column layouts cause ATS parsers to either skip sections entirely or scramble the order of content. If your contact information is in a header text box, some systems will never read it. If your skills are in a two-column table, they may get parsed as a single run-on string. The safest format: single column, standard section headings (Experience, Education, Skills), bullet points, no graphics. It's boring by design — and that's exactly what ATS software wants.
        </p>
        <h3 className="font-heading font-bold text-lg mt-6 mb-2" style={{ color: "#0A0A0A" }}>3. File format matters more than most people realize</h3>
        <p>
          When given the choice, submit a DOCX file over a PDF. PDF rendering is inconsistent across ATS platforms — some handle it well, many don't. DOCX files are parsed more reliably across all major systems. If the job posting specifies a format, follow it. If it says "any format," go with DOCX unless you have a strong reason not to.
        </p>
        <h3 className="font-heading font-bold text-lg mt-6 mb-2" style={{ color: "#0A0A0A" }}>4. Section titles need to be conventional</h3>
        <p>
          Getting creative with section headings ("My Journey," "Where I've Been," "What I Do") can confuse parsers that are trained on conventional labels. Stick to: Work Experience, Education, Skills, Certifications, Projects. These are the labels ATS platforms are built to recognize. Anything unconventional risks being miscategorized or ignored entirely.
        </p>
        <p>
          The bottom line: beating ATS isn't about gaming the system with hidden keywords or stuffing your resume with buzzwords. It's about speaking the system's language clearly — right keywords, clean formatting, conventional structure, and a file format the parser can actually read. Do those four things, and you've already cleared the filter most candidates fail on. Tools like ResumeX100 generate DOCX files specifically built to pass these parsers, tailored to the language of each individual job description — so you're not leaving the ATS filter to chance.
        </p>
      </div>
    ),
  },
  {
    slug: "5-minute-cover-letter-framework",
    title: "The 5-Minute Cover Letter Framework That Gets Callbacks",
    subtitle: "Most cover letters fail for the same reason. Here's the structure that fixes it.",
    readTime: "4 min read",
    date: "June 10, 2025",
    author: "ResumeX100 Team",
    preview: "Most cover letters are either too generic to matter or too long to be read. The solution isn't a better template — it's a sharper framework. Here's one that takes 5 minutes and actually gets read.",
    body: (
      <div className="space-y-5 text-base leading-relaxed" style={{ color: "#444" }}>
        <p>
          Most cover letters are either too generic to matter or too long to be read. "I am excited to apply for the [Role] position at [Company] because I am passionate about [Industry]" is not a cover letter — it's a formality that signals you didn't try. But the solution isn't to write more. It's to write more precisely, in less time, using a framework that forces you to be specific.
        </p>
        <p>
          Here's the structure. Four paragraphs. Five minutes, assuming you've already read the job description carefully.
        </p>
        <h3 className="font-heading font-bold text-lg mt-6 mb-2" style={{ color: "#0A0A0A" }}>Paragraph 1: The hook (2-3 sentences)</h3>
        <p>
          State the role you're applying for and lead immediately with the single most relevant thing about your background. Not your most impressive credential — the most <em>relevant</em> one. "I'm applying for the Senior Product Manager role. I've spent the last three years building fintech products at a Series B startup — including the payments feature that reduced churn by 18% — and your focus on reducing friction in SMB billing is exactly the problem set I want to work on next." Specific. Tailored. Done.
        </p>
        <h3 className="font-heading font-bold text-lg mt-6 mb-2" style={{ color: "#0A0A0A" }}>Paragraph 2: The proof (3-4 sentences)</h3>
        <p>
          Pick one or two concrete achievements that map directly to what the job description asks for. Use numbers wherever you have them. "In my current role, I led the migration of our onboarding flow from a 7-step process to 3 steps, which increased activation rates from 54% to 71% in 90 days. I worked directly with engineering, design, and customer success to do it — which mirrors the cross-functional ownership you're describing." This paragraph does the actual heavy lifting.
        </p>
        <h3 className="font-heading font-bold text-lg mt-6 mb-2" style={{ color: "#0A0A0A" }}>Paragraph 3: The company signal (2-3 sentences)</h3>
        <p>
          Show one specific thing you know about the company that most applicants don't bother to find out. This doesn't have to be obscure — it just has to be real. A recent product launch, a shift in strategy, a problem their customers are publicly talking about. "I noticed your team recently launched the contractor payment portal — and from the community discussions I've read, the biggest friction point is still international transfers. That's a problem I've worked on before and would want to dig into."
        </p>
        <h3 className="font-heading font-bold text-lg mt-6 mb-2" style={{ color: "#0A0A0A" }}>Paragraph 4: The close (1-2 sentences)</h3>
        <p>
          Don't beg. Don't over-apologize. Just express genuine interest and invite next steps with confidence. "I'd love to talk about how this experience maps to what you're building. Happy to share more context or examples whenever works for you."
        </p>
        <p>
          That's it. Four paragraphs. No fluff, no generic openers, no closing line about being "a perfect fit." The reason this framework works is that it forces you to do the one thing most cover letters skip: connect your specific experience to their specific problem. It takes 5 minutes because the structure is preset — your only job is to fill in the specifics. And those specifics are exactly what makes a hiring manager stop scrolling.
        </p>
      </div>
    ),
  },
];

export default function Blog() {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const openPost = POSTS.find((p) => p.slug === openSlug) ?? null;

  return (
    <main className="min-h-screen px-4 py-8 md:px-6" style={{ backgroundColor: "#F2F4F5" }}>
      <div className="max-w-4xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold mb-8" style={{ color: "#444" }}>
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>
        <div className="mb-8">
          <div className="chip-mint inline-flex mb-4">ResumeX100 Blog</div>
          <h1 className="font-heading font-bold text-3xl md:text-5xl mb-3" style={{ color: "#0A0A0A" }}>Resume advice that stays honest.</h1>
          <p className="text-base md:text-lg" style={{ color: "#666" }}>Short guides for truthful tailoring, ATS-safe formatting, and organized job campaigns.</p>
        </div>

        {/* Article list */}
        {!openPost && (
          <div className="grid gap-4">
            {POSTS.map((post) => (
              <article
                key={post.slug}
                className="card-base p-5 rounded-2xl flex items-start gap-4 cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => setOpenSlug(post.slug)}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#ECFFE0", color: "#047857" }}>
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-heading font-bold text-xl mb-1" style={{ color: "#0A0A0A" }}>{post.title}</h2>
                  <p className="text-sm leading-relaxed mb-3" style={{ color: "#666" }}>{post.preview}</p>
                  <div className="flex items-center gap-4 text-xs" style={{ color: "#999" }}>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{post.date}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{post.readTime}</span>
                    <span>{post.author}</span>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 mt-1 flex-shrink-0" style={{ color: "#00c447" }} />
              </article>
            ))}
          </div>
        )}

        {/* Full article view */}
        {openPost && (
          <div className="card-base rounded-2xl p-6 md:p-10">
            <button
              onClick={() => setOpenSlug(null)}
              className="inline-flex items-center gap-2 text-sm font-semibold mb-8"
              style={{ color: "#444", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              <ArrowLeft className="w-4 h-4" /> All articles
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="chip-mint inline-flex">ResumeX100 Blog</div>
              <div className="flex items-center gap-3 text-xs" style={{ color: "#999" }}>
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{openPost.date}</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{openPost.readTime}</span>
              </div>
            </div>

            <h1 className="font-heading font-bold text-2xl md:text-4xl mb-3 leading-tight" style={{ color: "#0A0A0A" }}>
              {openPost.title}
            </h1>
            <p className="text-base md:text-lg mb-2" style={{ color: "#666" }}>{openPost.subtitle}</p>
            <p className="text-sm mb-8 pb-6" style={{ color: "#999", borderBottom: "1px solid #E5E8EA" }}>
              By {openPost.author}
            </p>

            {openPost.body}

            <div className="mt-10 pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4" style={{ borderTop: "1px solid #E5E8EA" }}>
              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: "#0A0A0A" }}>Ready to tailor your resume for every role?</p>
                <p className="text-sm" style={{ color: "#666" }}>Generate up to 10 tailored resumes free — no card required.</p>
              </div>
              <Link href="/app" className="btn-mint shrink-0" style={{ fontSize: "0.9rem", padding: "0.55rem 1.1rem" }}>
                Try ResumeX100 Free <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <button
              onClick={() => setOpenSlug(null)}
              className="mt-6 inline-flex items-center gap-1 text-sm"
              style={{ color: "#888", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              <X className="w-3 h-3" /> Close article
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
