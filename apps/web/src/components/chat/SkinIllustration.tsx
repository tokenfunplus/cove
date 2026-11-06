import type { Skin } from "@/theme/skin";

/** Small vector studies of a wave, a layered circuit, and a folded ribbon. */
export function SkinIllustration({ skin }: { skin: Exclude<Skin, "grove"> }) {
  return (
    <svg
      viewBox="0 0 220 190"
      fill="none"
      aria-hidden="true"
      className="pointer-events-none w-full text-primary"
    >
      {skin === "continuum" && (
        <g transform="translate(9 22)" stroke="currentColor" strokeWidth="1.4">
          {Array.from({ length: 26 }, (_, line) => (
            <path
              key={line}
              d={`M ${4 + line * 1.55} ${100 + line * 1.55} C 35 ${87 + line * 1.6}, 58 ${-23 + line * 2.3}, 100 ${24 + line * 2.5} S ${147 + line * 1.4} ${96 + line}, ${158 + line * 1.45} ${44 + line * 1.85}`}
            />
          ))}
        </g>
      )}
      {skin === "blueprint" && (
        <g stroke="currentColor" strokeLinejoin="round">
          <path
            d="M15 140 122 78l84 48M22 77l161 93M110 8v165M47 61v66m125-66v66"
            strokeDasharray="3 5"
            opacity=".45"
          />
          {[100, 79, 58].map((y) => (
            <g key={y} transform={`translate(110 ${y})`}>
              <path d="m-66 0 66-36 66 36-66 36z" fill="var(--accent)" />
              <path d="m-66 0 66 36 66-36v6l-66 36-66-36z" fill="var(--card)" />
              <path d="m-44 0 44-24 44 24-44 24z" opacity=".55" />
              <path d="m-19 0 19-10 19 10-19 10z" fill="currentColor" />
            </g>
          ))}
          <path d="M15 32h10m-5-5v10m169 114h10m-5-5v10" />
        </g>
      )}
      {skin === "studio" && (
        <g transform="translate(110 95) rotate(-28)" stroke="currentColor">
          {Array.from({ length: 30 }, (_, line) => (
            <ellipse
              key={line}
              cx={(line - 15) * 1.55}
              cy="0"
              rx="47"
              ry="65"
              strokeWidth="1.45"
              transform={`rotate(${line * 3 - 44})`}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
