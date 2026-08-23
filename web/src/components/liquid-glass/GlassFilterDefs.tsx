export function GlassFilterDefs() {
  const scales = [0, 24, 48] as const;

  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
    >
      <defs>
        {scales.map((scale) => (
          <filter
            key={scale}
            id={scale === 24 ? "gary-edge-refraction" : `gary-edge-refraction-${scale}`}
            x="-12%"
            y="-12%"
            width="124%"
            height="124%"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href="/liquid-glass/maps/edge-displacement.svg"
              x="0"
              y="0"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result={`garyDisplacementMap${scale}`}
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2={`garyDisplacementMap${scale}`}
              scale={scale}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
