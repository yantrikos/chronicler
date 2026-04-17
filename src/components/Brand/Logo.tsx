// Chronicler logo — three-tier-write-contract mark + wordmark. Used in the
// empty-state splash and the header when a character is not yet loaded.

interface LogoProps {
  /** CSS size for the mark. Wordmark scales relative to it. */
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

export function Logo({
  size = 32,
  showWordmark = true,
  className = "",
}: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Mark size={size} />
      {showWordmark && (
        <span
          className="font-semibold tracking-tight text-neutral-100"
          style={{ fontSize: Math.round(size * 0.65) }}
        >
          Chronicler
        </span>
      )}
    </div>
  );
}

export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <defs>
        <linearGradient id="chr-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#059669" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#chr-grad)" />
      <rect x="16" y="17" width="22" height="6" rx="2" fill="#f8fafc" />
      <rect
        x="16"
        y="27"
        width="30"
        height="6"
        rx="2"
        fill="#f8fafc"
        fillOpacity="0.6"
      />
      <rect
        x="16"
        y="37"
        width="26"
        height="6"
        rx="2"
        fill="#f8fafc"
        fillOpacity="0.3"
      />
    </svg>
  );
}
