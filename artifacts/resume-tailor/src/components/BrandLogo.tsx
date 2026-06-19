interface BrandLogoProps {
  className?: string;
  imageClassName?: string;
  onDark?: boolean;
}

export function BrandLogo({ className = "", imageClassName = "h-10", onDark = false }: BrandLogoProps) {
  const wrapperClassName = [
    "inline-flex items-center",
    onDark ? "rounded-lg bg-white px-2.5 py-1.5" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <span className={wrapperClassName}>
      <img
        src="/resumex100-logo.png"
        alt="ResumeX100"
        className={`block w-auto max-w-full object-contain ${imageClassName}`}
      />
    </span>
  );
}
