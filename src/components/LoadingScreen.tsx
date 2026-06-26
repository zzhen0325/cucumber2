import { LoadingIndicator } from "@/components/LoadingIndicator";

export function LoadingScreen({ label = "连接中" }: { label?: string }) {
  return (
    <main
      className="grid min-h-screen w-screen place-content-center gap-3 bg-cuc-surface-warm text-center text-[13px] text-cuc-text-muted"
      aria-busy="true"
      aria-live="polite"
    >
      <LoadingIndicator ariaLabel={label} />
      <span>{label}</span>
    </main>
  );
}
