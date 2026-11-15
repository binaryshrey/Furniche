// A simplified Capital One wordmark (the red swoosh over the name), drawn as SVG so it scales and
// takes its text colour from the page. To use the official artwork, put it at
// public/brand/capital-one.svg and render an <img> with that source here instead.
export default function CapitalOneLogo({ className = "h-7 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 150 36" className={className} role="img" aria-label="Capital One">
      <path d="M4 17C26 3 66 -1 104 9" stroke="#d03027" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <text x="4" y="31" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="21" letterSpacing="-0.4" fill="currentColor">
        Capital One
      </text>
    </svg>
  );
}
