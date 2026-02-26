type AISignalInput = {
  commentRatio: number
  unusedFunctionCount: number
  maxDepth: number
  lineCount: number
}

export function estimateAIGenerated(input: AISignalInput) {
  let score = 0
  const reasons: string[] = []

  // コメント率
  if (input.commentRatio < 0.03) {
    score += 30
    reasons.push("Extremely low comments")
  } else if (input.commentRatio < 0.07) {
    score += 15
    reasons.push("Low comments")
  }

  // 未使用関数
  if (input.unusedFunctionCount >= 5) {
    score += 25
    reasons.push("Many unused functions")
  } else if (input.unusedFunctionCount >= 2) {
    score += 12
    reasons.push("Some unused functions")
  }

  // ネスト深度
  if (input.maxDepth >= 7) {
    score += 20
    reasons.push("Deep nesting")
  } else if (input.maxDepth >= 5) {
    score += 10
    reasons.push("Moderate nesting")
  }

  // ファイルサイズ
  if (input.lineCount >= 1000) {
    score += 15
    reasons.push("Large file size")
  } else if (input.lineCount >= 500) {
    score += 8
    reasons.push("Medium-large file")
  }

  const likelihood = Math.min(100, score)

  let level: "LOW" | "MEDIUM" | "HIGH" = "LOW"
  if (likelihood >= 70) level = "HIGH"
  else if (likelihood >= 40) level = "MEDIUM"

  return {
    aiLikelihood: likelihood,
    level,
    reasons,
  }
}
