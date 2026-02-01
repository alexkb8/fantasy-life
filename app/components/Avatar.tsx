"use client";

export default function Avatar({
  src,
  alt,
  size = 36,
}: {
  src?: string | null;
  alt: string;
  size?: number;
}) {
  const initials =
    alt
      .split(" ")
      .filter(Boolean)
      .map((s) => s[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "?";

  if (!src) {
    return (
      <div
        className="flex items-center justify-center rounded-full bg-slate-200 text-slate-700 font-bold border border-slate-300"
        style={{ width: size, height: size }}
        title={alt}
      >
        {initials}
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-full border border-slate-200 bg-white"
      style={{ width: size, height: size }}
      title={alt}
    >
      <img src={src} alt={alt} className="h-full w-full object-cover" />
    </div>
  );
}
