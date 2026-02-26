export function analyzeFileSize(code: string): {
  lineCount: number
  riskScore: number
} {
  const lines = code.split('\n')
  const lineCount = lines.filter(l => l.trim() !== '').length

  let riskScore = 0
  if (lineCount >= 1000) riskScore = 20
  else if (lineCount >= 500) riskScore = 10

  return { lineCount, riskScore }
}
