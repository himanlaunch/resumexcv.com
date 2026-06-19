import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F2F4F5" }}>
      <div className="text-center">
        <h1 className="font-heading font-bold text-5xl md:text-6xl mb-4" style={{ color: "#0A0A0A" }}>404</h1>
        <p className="text-lg mb-8" style={{ color: "#666" }}>Page not found.</p>
        <Link href="/" className="btn-mint">Go Home</Link>
      </div>
    </div>
  );
}
