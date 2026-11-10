/** Soft animated gradient blobs behind every page. Pure CSS, no JS. */
export function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-40 -left-32 h-[34rem] w-[34rem] rounded-full bg-coral/25 blur-[120px] animate-aurora" />
      <div
        className="absolute top-1/3 -right-40 h-[30rem] w-[30rem] rounded-full bg-violet/25 blur-[120px] animate-aurora"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="absolute -bottom-48 left-1/4 h-[28rem] w-[28rem] rounded-full bg-amber/15 blur-[120px] animate-aurora"
        style={{ animationDelay: "-12s" }}
      />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}
