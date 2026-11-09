import React from "react";

interface CaptchaDisplayProps {
  text: string;
}

const CaptchaDisplay: React.FC<CaptchaDisplayProps> = ({ text }) => {
  const chars = text.split("");

  // Deterministic seed based on text for consistent render within a request
  const seed = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

  const pseudoRandom = (n: number) => {
    return (Math.sin(seed + n) * 10000 % 1 + 1) % 1;
  };

  const dots = [...Array(200)].map((_, i) => ({
    x: pseudoRandom(i * 13) * 100,
    y: pseudoRandom(i * 17) * 100,
    r: pseudoRandom(i * 19) * 2,
    opacity: pseudoRandom(i * 23) * 0.7 + 0.3
  }));

  const decorativeCurves = [...Array(10)].map((_, i) => ({
    d: `M ${pseudoRandom(i * 7) * 100} ${pseudoRandom(i * 11) * 100} Q ${pseudoRandom(i * 13) * 100} ${pseudoRandom(i * 17) * 100} ${pseudoRandom(i * 19) * 100} ${pseudoRandom(i * 23) * 100}`,
    stroke: i % 2 === 0 ? "#f2682233" : "#ffffff11",
    width: pseudoRandom(i * 29) * 2 + 0.5
  }));

  return (
    <div className="captcha-container" style={{
      backgroundColor: '#050505',
      padding: '30px 20px',
      border: '1px solid #222',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '8px',
      minHeight: '130px',
      userSelect: 'none',
      boxShadow: 'inset 0 0 40px #000',
      borderRadius: '4px'
    }}>
      {/* Advanced Distortion Filters */}
      <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
        <defs>
          <filter id="ultraDistort">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="4" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="15" />
          </filter>
          <filter id="noiseFilter">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.1" />
            </feComponentTransfer>
          </filter>
        </defs>

        {/* Background Noise Dots */}
        {dots.map((dot, i) => (
          <circle key={i} cx={dot.x + "%"} cy={dot.y + "%"} r={dot.r} fill="#f26822" opacity={dot.opacity} />
        ))}

        {/* Confusing Background Curves */}
        {decorativeCurves.map((c, i) => (
          <path key={i} d={c.d} fill="none" stroke={c.stroke} strokeWidth={c.width} />
        ))}

        {/* Random Interference Lines */}
        {[...Array(20)].map((_, i) => (
          <line
            key={i}
            x1={pseudoRandom(i * 31) * 100 + "%"}
            y1={pseudoRandom(i * 37) * 100 + "%"}
            x2={pseudoRandom(i * 41) * 100 + "%"}
            y2={pseudoRandom(i * 43) * 100 + "%"}
            stroke={i % 4 === 0 ? "#f2682266" : "#333"}
            strokeWidth={pseudoRandom(i * 47) * 2 + 0.5}
          />
        ))}
      </svg>

      {/* Characters with Individual Transformation */}
      {chars.map((char, idx) => {
        const rotation = (pseudoRandom(idx * 53) - 0.5) * 60;
        const translateY = (pseudoRandom(idx * 59) - 0.5) * 25;
        const translateX = (pseudoRandom(idx * 61) - 0.5) * 15;
        const fontSize = 42 + pseudoRandom(idx * 67) * 12;
        const color = idx % 2 === 0 ? "#f26822" : "#ff8c42";

        return (
          <span
            key={idx}
            style={{
              display: 'inline-block',
              color: color,
              fontSize: `${fontSize}px`,
              fontWeight: '900',
              fontFamily: '"Courier New", Courier, monospace',
              transform: `rotate(${rotation}deg) translate(${translateX}px, ${translateY}px)`,
              textShadow: '3px 3px 0 #000, -1px -1px 0 #000, 0 0 10px rgba(242,104,34,0.3)',
              position: 'relative',
              zIndex: 2,
              filter: 'url(#ultraDistort)',
              opacity: 0.98,
              letterSpacing: '-2px'
            }}
          >
            {char}
          </span>
        );
      })}

      {/* Front-layer grain/noise overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#fff',
        filter: 'url(#noiseFilter)',
        pointerEvents: 'none',
        zIndex: 3,
        mixBlendMode: 'overlay'
      }} />
    </div>
  );
};

export default CaptchaDisplay;
