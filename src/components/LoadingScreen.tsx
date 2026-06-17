export function LoadingScreen() {
  return (
    <main className="app-state-screen" aria-busy="true" aria-live="polite">
      <img
        className="app-state-logo"
        src="/logocolor.svg"
        width="34"
        height="36"
        alt=""
        aria-hidden="true"
      />
      <span>连接中</span>
    </main>
  );
}
