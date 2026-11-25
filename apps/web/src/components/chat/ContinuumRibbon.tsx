import { useEffect, useId, useMemo, useRef, useState } from "react";

const strandCount = 26;
const subdivisions = 40;
const turn = 2 * Math.PI;
const initialPhase = 0.85;
const duration = "9s";

function cubic(a: number, b: number, c: number, d: number, t: number) {
  const u = 1 - t;
  return u ** 3 * a + 3 * u ** 2 * t * b + 3 * u * t ** 2 * c + t ** 3 * d;
}

// The two edges follow the original Continuum wave's joined Bezier curves.
function edgeAt(line: number, position: number) {
  const joinY = 24 + 2.5 * line;
  const handleY = -23 + 2.3 * line;
  if (position <= 0.5) {
    const t = position * 2;
    return {
      x: cubic(4 + 1.55 * line, 35, 58, 100, t),
      y: cubic(100 + 1.55 * line, 87 + 1.6 * line, handleY, joinY, t),
    };
  }
  const t = position * 2 - 1;
  return {
    x: cubic(100, 142, 147 + 1.4 * line, 158 + 1.45 * line, t),
    y: cubic(joinY, 2 * joinY - handleY, 96 + line, 44 + 1.85 * line, t),
  };
}

const sections = Array.from({ length: subdivisions + 1 }, (_, index) => {
  const position = index / subdivisions;
  const top = edgeAt(0, position);
  const bottom = edgeAt(strandCount - 1, position);
  return {
    position,
    x: (top.x + bottom.x) / 2,
    y: (top.y + bottom.y) / 2,
    halfX: (bottom.x - top.x) / 2,
    halfY: (bottom.y - top.y) / 2,
  };
});

function strandsAt(phase: number) {
  const foldCenter = 0.5 + 0.16 * Math.sin(phase);
  const foldAngle = 1.24 + 0.49 * Math.cos(phase);
  const strands = Array.from({ length: strandCount }, (): string[] => []);
  for (const section of sections) {
    const distance = (section.position - foldCenter) / 0.205;
    const angle = foldAngle * Math.exp(-0.5 * distance ** 2);
    const wave = turn * section.position - phase;
    const x = section.x + 3 * Math.cos(wave);
    const y = section.y + 6 * Math.sin(wave + 0.6);
    // Project the turning cross-section onto the plane of the illustration.
    const dx = section.halfX * Math.cos(angle) - 13 * Math.sin(angle);
    const dy = section.halfY * Math.cos(angle) + 2 * Math.sin(angle);
    strands.forEach((points, index) => {
      const across = 2 * index / (strandCount - 1) - 1;
      points.push(`${(x + across * dx).toFixed(1)},${(y + across * dy).toFixed(1)}`);
    });
  }
  return strands.map(points => points.join(" "));
}

const restPose = strandsAt(initialPhase);

function foldKeyframes() {
  const frameCount = 24;
  const poses = [restPose];
  for (let frame = 1; frame < frameCount; frame++) {
    poses.push(strandsAt(initialPhase + turn * frame / frameCount));
  }
  poses.push(restPose);
  return restPose.map((_, line) => poses.map(pose => pose[line]).join(";"));
}

export function ContinuumRibbon() {
  const gradient = useId();
  const group = useRef<SVGGElement>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const svg = group.current?.ownerSVGElement;
    if (!svg || typeof IntersectionObserver === "undefined") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = false;
    function update() {
      setMoving(inView && !document.hidden && !preference.matches);
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    observer.observe(svg);
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const frames = useMemo(() => moving ? foldKeyframes() : null, [moving]);

  return (
    <g ref={group} transform="translate(9 22)" strokeWidth="1.28" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient
          id={gradient} gradientUnits="userSpaceOnUse"
          x1="22" y1="0" x2="119" y2="14" spreadMethod="reflect"
        >
          <stop stopColor="color-mix(in srgb, var(--primary) 65%, var(--foreground))" />
          <stop offset=".48" stopColor="var(--primary)" />
          <stop offset="1" stopColor="color-mix(in srgb, var(--primary) 56%, var(--background))" />
          {frames && (
            <animateTransform
              attributeName="gradientTransform" type="translate" from="0 0" to="194 28"
              dur={duration} repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>
      {restPose.map((points, line) => (
        <polyline
          key={line} points={points} stroke={`url(#${gradient})`}
          strokeOpacity={0.82 + 0.18 * Math.abs(2 * line / (strandCount - 1) - 1)}
        >
          {frames && <animate attributeName="points" values={frames[line]} dur={duration} repeatCount="indefinite" />}
        </polyline>
      ))}
    </g>
  );
}
