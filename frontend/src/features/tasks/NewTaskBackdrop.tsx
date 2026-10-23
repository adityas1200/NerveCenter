/**
 * The New task backdrop, drawn behind the heading and the box: a soft wash of the brand's iris with a
 * sky and a rose note, orbit rings centred on Sonic's mark with a few dots travelling them slowly, and
 * a dot grid that fades out toward the edges. Lines and dots take theme tokens, so it holds in both
 * themes; it is decoration only (aria-hidden, no pointer events) and stands still under reduced motion.
 * `centerY` is the mark's centre measured from the top of the page content; the backdrop reaches
 * `LIFT` px above it, under the clear top bar, so the glow fades out instead of meeting an edge.
 */
const LIFT = 140;
const RINGS = [
  { r: 92, dash: undefined, dots: [{ angle: 210, color: "rgb(var(--c-brand))", size: 4 }], speed: "orbit-slow" },
  { r: 168, dash: "2 6", dots: [{ angle: 20, color: "rgb(var(--tw-sky-500))", size: 3.5 }, { angle: 250, color: "rgb(var(--c-brand))", size: 3 }], speed: "orbit-slower" },
  { r: 262, dash: undefined, dots: [{ angle: 140, color: "rgb(var(--tw-rose-400))", size: 3.5 }], speed: "orbit-slowest" },
  { r: 372, dash: "2 8", dots: [], speed: "" },
];

export function NewTaskBackdrop({ centerY: fromContent = 96 }: { centerY?: number }) {
  const width = 1200;
  const height = 700;
  const centerY = fromContent + LIFT;
  const cx = width / 2;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute left-1/2 -z-10 h-[700px] w-[1200px] -translate-x-1/2 select-none [mask-image:radial-gradient(ellipse_55%_60%_at_50%_38%,black_35%,transparent_100%)]" style={{ top: -LIFT }}>
      <div className="newtask-aurora absolute inset-0">
        <span className="absolute left-1/2 h-[340px] w-[520px] -translate-x-1/2 rounded-full bg-brand/25 blur-[90px]" style={{ top: centerY - 150 }} />
        <span className="newtask-drift-a absolute h-[240px] w-[340px] rounded-full bg-sky-300/30 blur-[90px]" style={{ top: centerY - 60, left: cx - 420 }} />
        <span className="newtask-drift-b absolute h-[220px] w-[320px] rounded-full bg-rose-300/25 blur-[90px]" style={{ top: centerY - 40, left: cx + 110 }} />
      </div>
      <div className="dot-grid-fade absolute inset-0" />
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 overflow-visible">
        {RINGS.map((ring) => (
          <g key={ring.r}>
            <circle cx={cx} cy={centerY} r={ring.r} fill="none" stroke="rgb(var(--c-line-strong))" strokeOpacity={0.8} strokeDasharray={ring.dash} />
            {ring.dots.length ? (
              <g className={ring.speed} style={{ transformOrigin: `${cx}px ${centerY}px` }}>
                {ring.dots.map((dot) => {
                  const radians = (dot.angle * Math.PI) / 180;
                  const x = cx + ring.r * Math.cos(radians);
                  const y = centerY + ring.r * Math.sin(radians);
                  return (
                    <g key={dot.angle}>
                      <circle cx={x} cy={y} r={dot.size * 2.6} fill={dot.color} opacity={0.14} />
                      <circle cx={x} cy={y} r={dot.size} fill={dot.color} />
                    </g>
                  );
                })}
              </g>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}
