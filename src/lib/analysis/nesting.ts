export function analyzeNestingDepth(code: string): {
  maxDepth: number
  riskScore: number
} {
  let depth = 0
  let maxDepth = 0

  for (let i = 0; i < code.length; i++) {
    const char = code[i]

    if (char === '{') {
      depth++
      if (depth > maxDepth) {
        maxDepth = depth
      }
    }

    if (char === '}') {
      depth = Math.max(0, depth - 1)
    }
  }

  // スコア計算（暫定）
  let riskScore = 0
  if (maxDepth >= 7) riskScore = 15
  else if (maxDepth >= 5) riskScore = 10
  else if (maxDepth >= 3) riskScore = 5

  return { maxDepth, riskScore }
}
