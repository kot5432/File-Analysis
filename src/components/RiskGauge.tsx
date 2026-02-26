import React from "react"

type Props = {
  score: number // 0-100
  level: "LOW" | "MEDIUM" | "HIGH"
}

export const RiskGauge: React.FC<Props> = ({ score, level }) => {
  const radius = 60
  const stroke = 10
  const normalizedRadius = radius - stroke / 2
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset =
    circumference - (score / 100) * circumference

  const color =
    level === "HIGH"
      ? "#ef4444"
      : level === "MEDIUM"
      ? "#f59e0b"
      : "#22c55e"

  return (
    <div className="flex flex-col items-center gap-2">
      <svg height={radius * 2} width={radius * 2}>
        {/* 背景円 */}
        <circle
          stroke="#e5e7eb"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />

        {/* プログレス */}
        <circle
          stroke={color}
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          transform={`rotate(-90 ${radius} ${radius})`}
        />
      </svg>

      <div className="text-center">
        <div className="text-2xl font-bold">{score}</div>
        <div
          className="text-sm font-semibold"
          style={{ color }}
        >
          {level}
        </div>
      </div>
    </div>
  )
}
