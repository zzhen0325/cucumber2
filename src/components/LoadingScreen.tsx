import { LoadingIndicator } from "@/components/LoadingIndicator";

export function LoadingScreen({ label = "连接中" }: { label?: string }) {
  return (
    <main className="app-state-screen" aria-busy="true" aria-live="polite">
      <LoadingIndicator ariaLabel={label} />
      <span>{label}</span>
    </main>
  );
}
