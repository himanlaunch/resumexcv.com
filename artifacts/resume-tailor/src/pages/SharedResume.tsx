import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Loader2, AlertCircle, FileText } from "lucide-react";
import { type ResumeData, getSharedResume } from "@/lib/api";
import { BrandLogo } from "@/components/BrandLogo";
import { sanitizeResumeForExport } from "@/lib/resumeSafety";

function ResumePreview({ resume, jobTitle, jobCompany }: { resume: ResumeData; jobTitle?: string; jobCompany?: string }) {
  resume = sanitizeResumeForExport(resume);
  const name = resume.contact?.name ?? "Resume";
  const contactParts = [resume.contact?.email, resume.contact?.location, resume.contact?.linkedin, resume.contact?.github].filter(Boolean);

  return (
    <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 13, lineHeight: 1.6, color: "#222", padding: "28px 32px", background: "white", borderRadius: 8, border: "1px solid #E5E7EB" }}>
      {jobTitle && jobCompany && (
        <div style={{ fontSize: 11, color: "#00796b", marginBottom: 16, padding: "5px 10px", background: "#E8F5E9", borderRadius: 4, textAlign: "center" }}>
          Tailored for: <strong>{jobTitle}</strong> at <strong>{jobCompany}</strong>
        </div>
      )}
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#0A0A0A", letterSpacing: "-0.3px", marginBottom: 4 }}>{name}</div>
        {contactParts.length > 0 && <div style={{ fontSize: 12, color: "#555" }}>{contactParts.join(" | ")}</div>}
      </div>

      {resume.summary && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#555", borderBottom: "1px solid #DDD", paddingBottom: 4, marginBottom: 10, marginTop: 18 }}>Summary</div>
          <p style={{ fontSize: 13, color: "#222", margin: 0 }}>{resume.summary}</p>
        </>
      )}

      {(resume.skills ?? []).length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#555", borderBottom: "1px solid #DDD", paddingBottom: 4, marginBottom: 10, marginTop: 18 }}>Skills</div>
          <p style={{ fontSize: 12.5, color: "#333", margin: 0 }}>{resume.skills!.join(" · ")}</p>
        </>
      )}

      {(resume.experience ?? []).length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#555", borderBottom: "1px solid #DDD", paddingBottom: 4, marginBottom: 10, marginTop: 18 }}>Experience</div>
          {resume.experience!.map((exp, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: 13.5, color: "#111" }}>{exp.title}</strong>
                <span style={{ fontSize: 12, color: "#666" }}>{exp.period}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "#444", marginBottom: 4 }}>{exp.company}</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(exp.bullets ?? []).map((b, bi) => (
                  <li key={bi} style={{ fontSize: 13, color: "#222", marginBottom: 3 }}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {(resume.education ?? []).length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#555", borderBottom: "1px solid #DDD", paddingBottom: 4, marginBottom: 10, marginTop: 18 }}>Education</div>
          {resume.education!.map((e, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "#111" }}><strong>{e.degree}</strong>, {e.school}</span>
              <span style={{ fontSize: 12, color: "#666" }}>{e.year}</span>
            </div>
          ))}
        </>
      )}

      {(resume.certifications ?? []).length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#555", borderBottom: "1px solid #DDD", paddingBottom: 4, marginBottom: 10, marginTop: 18 }}>Certifications</div>
          {resume.certifications!.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: "#222", marginBottom: 3 }}>• {c}</div>
          ))}
        </>
      )}
    </div>
  );
}

export default function SharedResume() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ resume: ResumeData; jobTitle: string; jobCompany: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getSharedResume(id)
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : "Failed to load resume"))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#F5F5F5", padding: "24px 12px 32px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <BrandLogo imageClassName="h-10" />
        </div>

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "80px 0", color: "#888" }}>
            <Loader2 style={{ width: 36, height: 36, color: "#00F0A0", animation: "spin 1s linear infinite" }} />
            <p style={{ fontSize: 14, fontFamily: "system-ui" }}>Loading resume…</p>
          </div>
        )}

        {error && !loading && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 20, borderRadius: 12, backgroundColor: "#FEE2E2", border: "1px solid #FCA5A5" }}>
            <AlertCircle style={{ width: 20, height: 20, color: "#EF4444", flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#991B1B", margin: "0 0 4px", fontFamily: "system-ui" }}>Resume not found</p>
              <p style={{ fontSize: 13, color: "#7F1D1D", margin: 0, fontFamily: "system-ui" }}>{error}</p>
            </div>
          </div>
        )}

        {data && !loading && (
          <>
            <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, backgroundColor: "#ECFFE0", border: "1px solid rgba(0,240,160,0.4)", display: "flex", alignItems: "flex-start", gap: 10 }}>
              <FileText style={{ width: 16, height: 16, color: "#00c447", flexShrink: 0 }} />
              <p style={{ fontSize: 13, color: "#005A3D", margin: 0, fontFamily: "system-ui" }}>
                Tailored resume for <strong>{data.jobTitle}</strong> at <strong>{data.jobCompany}</strong> — shared via ResumeX100
              </p>
            </div>
            <div style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.08)", borderRadius: 10, overflowX: "auto", WebkitOverflowScrolling: "touch" as const }}>
              <div style={{ minWidth: 640 }}>
                <ResumePreview resume={data.resume} jobTitle={data.jobTitle} jobCompany={data.jobCompany} />
              </div>
            </div>
            <p style={{ textAlign: "center", fontSize: 12, color: "#aaa", marginTop: 24, fontFamily: "system-ui" }}>
              This link is valid for 7 days · Created with ResumeX100
            </p>
          </>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
