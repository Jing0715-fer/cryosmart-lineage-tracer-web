"use client";

import { useEffect, useState } from "react";

/**
 * Animated lineage DAG visualization for the hero section.
 * Shows a representative cryo-EM workflow: import → motion → CTF →
 * picker → extract → 2D class → select → ab initio → refine.
 * Nodes pulse and edges animate to convey the "tracing" concept.
 */
const NODES = [
  { id: "import", label: "Import", type: "exposure", x: 60, y: 40 },
  { id: "motion", label: "Motion", type: "exposure", x: 60, y: 120 },
  { id: "ctf", label: "CTF", type: "exposure", x: 60, y: 200 },
  { id: "picker", label: "Picker", type: "particle", x: 200, y: 160 },
  { id: "extract", label: "Extract", type: "particle", x: 200, y: 240 },
  { id: "class2d", label: "2D Class", type: "particle", x: 340, y: 200 },
  { id: "select", label: "Select", type: "particle", x: 340, y: 280 },
  { id: "abinit", label: "Ab initio", type: "volume", x: 480, y: 160 },
  { id: "refine", label: "Refine", type: "volume", x: 480, y: 240 },
];

const EDGES: Array<[string, string]> = [
  ["import", "motion"],
  ["motion", "ctf"],
  ["ctf", "picker"],
  ["picker", "extract"],
  ["extract", "class2d"],
  ["class2d", "select"],
  ["select", "abinit"],
  ["select", "refine"],
  ["abinit", "refine"],
];

const TYPE_COLORS: Record<string, string> = {
  exposure: "#06b6d4", // cyan
  particle: "#10b981", // emerald
  volume: "#0d9488", // teal
};

export function HeroVisualization() {
  const [activeIdx, setActiveIdx] = useState(0);

  // Cycle through nodes to simulate "tracing" animation.
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % (NODES.length + 2));
    }, 900);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative">
      {/* Glow background */}
      <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br from-teal-500/10 via-emerald-500/5 to-cyan-500/10 blur-2xl" />

      <svg
        viewBox="0 0 580 340"
        className="h-auto w-full"
        style={{ filter: "drop-shadow(0 4px 12px rgba(13, 148, 136, 0.12))" }}
      >
        <defs>
          <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0d9488" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#10b981" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.3" />
          </linearGradient>
          <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Edges */}
        {EDGES.map(([from, to], i) => {
          const fromNode = NODES.find((n) => n.id === from)!;
          const toNode = NODES.find((n) => n.id === to)!;
          const isAnimated = activeIdx > 0 && i < activeIdx;
          const isCurrent = i === activeIdx - 1;
          return (
            <g key={`${from}-${to}`}>
              <line
                x1={fromNode.x + 24}
                y1={fromNode.y + 12}
                x2={toNode.x - 4}
                y2={toNode.y + 12}
                stroke={isCurrent ? "#10b981" : isAnimated ? "url(#edge-gradient)" : "#cbd5e1"}
                strokeWidth={isCurrent ? 2.5 : 1.5}
                strokeDasharray={isAnimated ? "0" : "4 3"}
                opacity={isAnimated ? 0.9 : 0.5}
                style={{ transition: "all 0.4s ease" }}
              />
              {/* Flowing dot on animated edges */}
              {isAnimated && (
                <circle r="2.5" fill="#10b981" opacity="0.8">
                  <animateMotion
                    dur="1.5s"
                    repeatCount="indefinite"
                    path={`M${fromNode.x + 24},${fromNode.y + 12} L${toNode.x - 4},${toNode.y + 12}`}
                  />
                </circle>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {NODES.map((node, i) => {
          const isPast = i < activeIdx;
          const isCurrent = i === activeIdx;
          const color = TYPE_COLORS[node.type] || "#64748b";
          return (
            <g key={node.id} style={{ transition: "all 0.4s ease" }}>
              {/* Pulse ring on current node */}
              {isCurrent && (
                <circle
                  cx={node.x + 10}
                  cy={node.y + 12}
                  r="20"
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  opacity="0.4"
                >
                  <animate attributeName="r" from="16" to="28" dur="0.9s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.6" to="0" dur="0.9s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Node background */}
              <rect
                x={node.x}
                y={node.y}
                width={108}
                height={26}
                rx={7}
                fill={isPast || isCurrent ? color : "#f8fafc"}
                stroke={color}
                strokeWidth={isCurrent ? 2 : 1}
                opacity={isPast || isCurrent ? 1 : 0.6}
                filter={isCurrent ? "url(#node-glow)" : undefined}
                style={{ transition: "all 0.4s ease" }}
              />
              {/* Node label */}
              <text
                x={node.x + 54}
                y={node.y + 17}
                textAnchor="middle"
                fontSize="11"
                fontWeight={isCurrent ? 700 : 500}
                fill={isPast || isCurrent ? "white" : "#475569"}
                style={{ transition: "all 0.4s ease" }}
              >
                {node.label}
              </text>
              {/* Type indicator dot */}
              <circle
                cx={node.x + 12}
                cy={node.y + 13}
                r="3"
                fill={isPast || isCurrent ? "white" : color}
                opacity={0.9}
              />
            </g>
          );
        })}

        {/* Legend at bottom */}
        <g transform="translate(60, 310)">
          {Object.entries(TYPE_COLORS).map(([type, color], i) => (
            <g key={type} transform={`translate(${i * 120}, 0)`}>
              <circle cx="0" cy="0" r="4" fill={color} />
              <text x="10" y="4" fontSize="10" fill="#64748b" fontWeight="500">
                {type === "exposure" ? "Micrographs" : type === "particle" ? "Particles" : "Maps"}
              </text>
            </g>
          ))}
        </g>
      </svg>

      {/* Stats overlay */}
      <div className="pointer-events-none absolute right-3 top-3 rounded-lg bg-white/80 px-2.5 py-1.5 text-[10px] font-mono text-slate-600 shadow-sm backdrop-blur">
        <span className="text-teal-600">●</span> tracing upstream…
      </div>
    </div>
  );
}
