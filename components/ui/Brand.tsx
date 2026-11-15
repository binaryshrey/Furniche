import Link from "next/link";

// The sofa icon on its own (the header logo and the loading screen both use it).
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
      <rect x="1" y="9" width="20" height="8" rx="3" fill="#f7f7f7" />
      <rect x="3" y="4" width="16" height="7" rx="3" fill="#fc7249" />
      <rect x="3" y="17" width="2" height="3" fill="#f7f7f7" />
      <rect x="17" y="17" width="2" height="3" fill="#f7f7f7" />
    </svg>
  );
}

export function Logo({
  className = "",
  name = "FurNiche AI",
}: {
  className?: string;
  name?: string;
}) {
  return (
    <Link
      href="/"
      className={`flex items-center gap-2 ${className}`}
      aria-label={`${name} home`}
    >
      <LogoMark />
      <span className="font-display text-xl tracking-tight">{name}</span>
    </Link>
  );
}

export const REPO = "https://github.com/binaryshrey/Furniche";

// home: the landing page's bare header (no divider, a single Github link to the repo).
export function TopNav({
  right,
  name,
  home = false,
  accountHref,
}: {
  right?: React.ReactNode;
  name?: string;
  home?: boolean;
  accountHref?: string; // replaces the Cart link with "My Account", opened in a new tab
}) {
  const link = "rounded-full px-3 py-2 transition hover:bg-card";
  if (home) {
    return (
      <header className="flex items-center justify-between gap-4 bg-paper px-4 py-4 sm:px-6">
        <Logo name={name} />
        <a
          href={REPO}
          target="_blank"
          rel="noopener noreferrer"
          className={`${link} text-sm font-semibold`}
        >
          Github
        </a>
      </header>
    );
  }
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-paper px-4 py-4 sm:px-6">
      <Logo name={name} />
      <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-2">
        <Link href="/explore" className={link}>
          Homes
        </Link>
        <Link href="/boards" className={link}>
          Looks
        </Link>
        {accountHref ? (
          <a
            href={accountHref}
            target="_blank"
            rel="noopener noreferrer"
            className={link}
          >
            My Account
          </a>
        ) : (
          <Link href="/cart" className={link}>
            Cart
          </Link>
        )}
        {right}
      </nav>
    </header>
  );
}
