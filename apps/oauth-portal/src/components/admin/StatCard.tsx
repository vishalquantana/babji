"use client";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
  sparklineData?: number[];
  color: string;
  borderColor?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const width = 64;
  const height = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StatCard({
  label,
  value,
  trend,
  trendUp,
  sparklineData,
  color,
  borderColor = "#e2e8f0",
  icon,
  onClick,
}: StatCardProps) {
  const trendColor =
    trendUp === true ? "#22c55e" : trendUp === false ? "#ef4444" : color;

  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: "#ffffff",
        borderRadius: 12,
        padding: 16,
        border: `1px solid ${borderColor}`,
        cursor: onClick ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      {/* Left side */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            textTransform: "uppercase",
            fontSize: 10,
            letterSpacing: "0.05em",
            color: "#64748b",
            fontWeight: 600,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#0f172a",
            lineHeight: 1.2,
          }}
        >
          {value}
        </span>
        {trend && (
          <span
            style={{
              fontSize: 11,
              color: trendColor,
              fontWeight: 500,
            }}
          >
            {trend}
          </span>
        )}
      </div>

      {/* Right side: sparkline or icon */}
      {sparklineData && sparklineData.length > 1 ? (
        <div style={{ flexShrink: 0 }}>
          <Sparkline data={sparklineData} color={color} />
        </div>
      ) : icon ? (
        <div
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: "50%",
            backgroundColor: `${color}15`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: color,
          }}
        >
          {icon}
        </div>
      ) : null}
    </div>
  );
}

export default StatCard;
