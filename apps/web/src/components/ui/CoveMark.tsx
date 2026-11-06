import { primitivesStyles } from "@/styles/primitives";
/** A friendly conversation bubble, drawn locally without external assets. */
export function CoveMark() {
  return (
    <svg
      aria-hidden="true"
      className={primitivesStyles.coveMark}
      viewBox="0 0 48 48"
      fill="none"
    >
      <path
        d="M8 18C8 10 14 5 24 5s17 6 17 16-7 17-17 17h-5l-9 5 1-11C9 29 8 24 8 18Z"
        fill="currentColor"
      />
      <g stroke="var(--card)" strokeWidth="2.5" strokeLinecap="round">
        <path d="M18 19v2m12-2v2m-11 7c3 3 7 3 10 0" />
      </g>
    </svg>
  );
}
