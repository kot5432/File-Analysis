type BlackboxInput = {
  nestingScore: number
  commentScore: number
  fileSizeScore: number
}

export function calculateBlackboxRisk(input: BlackboxInput) {
  const rawTotal =
    input.nestingScore +
    input.commentScore +
    input.fileSizeScore

  const MAX_RAW = 50

  // 100点スケールに正規化
  const blackboxScore = Math.round((rawTotal / MAX_RAW) * 100)

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'

  if (blackboxScore >= 70) riskLevel = 'HIGH'
  else if (blackboxScore >= 40) riskLevel = 'MEDIUM'

  return {
    blackboxScore,
    riskLevel,
    breakdown: {
      nesting: input.nestingScore,
      comments: input.commentScore,
      fileSize: input.fileSizeScore
    }
  }
}
