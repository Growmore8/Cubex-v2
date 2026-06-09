// Decorative dotted world-map overlay for the account card (premium credit-card
// look). Lightweight: one dot <pattern> masked by continent shapes — no per-dot
// DOM. Renders white dots; control intensity with the `opacity` prop and let the
// card's gradient show through underneath.
export default function WorldMapBg({ opacity = 0.16 }: { opacity?: number }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1000 500"
      preserveAspectRatio="xMidYMid slice"
      style={{ opacity }}
      aria-hidden
    >
      <defs>
        <pattern id="wm-dots" width="13" height="13" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.6" fill="#fff" />
        </pattern>
        <mask id="wm-land">
          <rect width="1000" height="500" fill="#000" />
          <g fill="#fff">
            {/* North America */}
            <ellipse cx="215" cy="150" rx="115" ry="78" />
            <ellipse cx="150" cy="120" rx="60" ry="45" />
            <ellipse cx="270" cy="210" rx="45" ry="40" />
            {/* Greenland */}
            <ellipse cx="370" cy="80" rx="40" ry="32" />
            {/* South America */}
            <ellipse cx="320" cy="330" rx="52" ry="78" />
            <ellipse cx="300" cy="400" rx="30" ry="55" />
            {/* Europe */}
            <ellipse cx="520" cy="140" rx="55" ry="42" />
            {/* Africa */}
            <ellipse cx="545" cy="285" rx="78" ry="100" />
            <ellipse cx="560" cy="350" rx="45" ry="55" />
            {/* Asia */}
            <ellipse cx="720" cy="160" rx="165" ry="92" />
            <ellipse cx="800" cy="240" rx="70" ry="55" />
            {/* SE Asia / Indonesia */}
            <ellipse cx="800" cy="320" rx="60" ry="28" />
            {/* Australia */}
            <ellipse cx="845" cy="370" rx="68" ry="48" />
          </g>
        </mask>
      </defs>
      <rect width="1000" height="500" fill="url(#wm-dots)" mask="url(#wm-land)" />
    </svg>
  );
}
