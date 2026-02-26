export function detectUnusedFunctions(code: string) {
  const functionNames: string[] = []
  const unused: string[] = []

  // 関数定義検出（MVP）
  const patterns = [
    /function\s+([a-zA-Z0-9_]+)/g,
    /const\s+([a-zA-Z0-9_]+)\s*=\s*\(/g,
    /def\s+([a-zA-Z0-9_]+)/g,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(code)) !== null) {
      if (!functionNames.includes(match[1])) {
        functionNames.push(match[1])
      }
    }
  }

  // 使用回数チェック
  for (const name of functionNames) {
    const regex = new RegExp(`\\b${name}\\b`, 'g')
    const matches = code.match(regex)
    const count = matches ? matches.length : 0

    if (count <= 1) {
      unused.push(name)
    }
  }

  // スコア（暫定）
  let riskScore = 0
  if (unused.length >= 5) riskScore = 15
  else if (unused.length >= 2) riskScore = 8
  else if (unused.length >= 1) riskScore = 4

  return {
    unusedFunctions: unused,
    count: unused.length,
    riskScore,
  }
}
