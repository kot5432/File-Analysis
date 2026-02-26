export function analyzeCommentRatio(code: string): {
  commentRatio: number
  riskScore: number
  commentLines: number
  totalLines: number
} {
  const lines = code.split('\n')

  let commentLines = 0
  let inBlockComment = false

  for (const line of lines) {
    const trimmed = line.trim()

    // ブロックコメント中
    if (inBlockComment) {
      commentLines++
      if (trimmed.includes('*/')) {
        inBlockComment = false
      }
      continue
    }

    // 空行は除外（重要）
    if (trimmed === '') continue

    // 行コメント
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#')
    ) {
      commentLines++
      continue
    }

    // ブロックコメント開始
    if (trimmed.startsWith('/*')) {
      commentLines++
      if (!trimmed.includes('*/')) {
        inBlockComment = true
      }
      continue
    }
  }

  const totalLines = lines.filter(l => l.trim() !== '').length
  const commentRatio =
    totalLines === 0 ? 0 : commentLines / totalLines

  // スコア計算
  let riskScore = 0
  if (commentRatio < 0.05) riskScore = 15
  else if (commentRatio < 0.1) riskScore = 8

  return {
    commentRatio,
    riskScore,
    commentLines,
    totalLines
  }
}
