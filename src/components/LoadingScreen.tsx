import { LoadingIndicator } from "@/components/LoadingIndicator";

export function LoadingScreen({ label = "连接中" }: { label?: string }) {
  return (
    <main
      className="flex flex-col justify-center items-center min-h-screen w-screen place-content-center gap-3 bg-surface-warm text-center text-[13px] text-text-muted"
      aria-busy="true"
      aria-live="polite"
    >
      <LoadingIndicator ariaLabel={label} />
      <span>{label}</span>
    </main>
  );
}
