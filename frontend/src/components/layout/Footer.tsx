export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>ResearchForge — an AI research copilot for neuroimaging and computational neuroscience.</span>
        <span className="font-mono">v0.2 · local development build</span>
      </div>
    </footer>
  );
}
