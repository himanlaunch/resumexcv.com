import { Link } from "wouter";
import { ArrowLeft, ArrowRight, FileText } from "lucide-react";

const POSTS = [
  {
    title: "How to tailor a resume without inventing experience",
    desc: "A practical guide to rewriting for relevance while keeping every claim grounded in your actual work.",
  },
  {
    title: "What ATS systems actually parse",
    desc: "The formatting choices that help applicant tracking systems read your resume cleanly.",
  },
  {
    title: "Using job descriptions as a checklist",
    desc: "How to compare a posting against your experience and decide what belongs in a tailored resume.",
  },
];

export default function Blog() {
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

        <div className="grid gap-4">
          {POSTS.map((post) => (
            <article key={post.title} className="card-base p-5 rounded-2xl flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#ECFFE0", color: "#047857" }}>
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h2 className="font-heading font-bold text-xl mb-1" style={{ color: "#0A0A0A" }}>{post.title}</h2>
                <p className="text-sm leading-relaxed" style={{ color: "#666" }}>{post.desc}</p>
              </div>
              <ArrowRight className="w-4 h-4 mt-1 flex-shrink-0" style={{ color: "#00c447" }} />
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
