// パス正規化
function normalizePath(path: string) {
  return path.replace(/\\/g, "/")
}

// 相対パス解決
function resolveRelativePath(from: string, relative: string) {
  const baseParts = from.split("/").slice(0, -1)
  const relParts = relative.split("/")

  const stack = [...baseParts]

  for (const part of relParts) {
    if (part === "." || part === "") continue
    if (part === "..") stack.pop()
    else stack.push(part)
  }

  return normalizePath(stack.join("/"))
}

// 拡張子補完
const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".java",
  ".cpp",
  ".c",
  ".h",
  ".cs",
  ".php",
  ".rb",
  ".go",
  ".rs",
  ".swift",
  ".kt",
  ".scala",
  ".r",
  ".m",
  ".sh",
  ".sql",
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".md",
  ".txt"
]

function tryResolveWithExtensions(
  basePath: string,
  fileMap: Record<string, string>
) {
  // 完全一致
  if (fileMap[basePath]) return basePath

  // 拡張子補完
  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext
    if (fileMap[candidate]) return candidate
  }

  // index解決
  for (const ext of EXTENSIONS) {
    const candidate = `${basePath}/index${ext}` 
    if (fileMap[candidate]) return candidate
  }

  return null
}

// メイン解決関数
export function resolveImport(
  fromFile: string,
  importPath: string,
  fileMap: Record<string, string>
): string | null {
  // 相対のみ処理（MVP）
  if (!importPath.startsWith(".")) return null

  const resolvedBase = resolveRelativePath(
    fromFile,
    importPath
  )

  return tryResolveWithExtensions(
    resolvedBase,
    fileMap
  )
}

// 依存関係抽出
export function extractDependencies(code: string): string[] {
  const dependencies: string[] = []
  
  // import文の抽出
  const importMatches = code.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || [];
  dependencies.push(...importMatches.map(match => 
    match.match(/from\s+['"]([^'"]+)['"]/)?.[1] || ''
  ));
  
  // require文の抽出
  const requireMatches = code.match(/require\(['"]([^'"]+)['"]\)/g) || [];
  dependencies.push(...requireMatches.map(match => 
    match.match(/require\(['"]([^'"]+)['"]\)/)?.[1] || ''
  ));
  
  // 重複を除去して返す
  const uniqueDeps = dependencies.filter(dep => dep && dep.startsWith('.'))
  const result: string[] = []
  for (const dep of uniqueDeps) {
    if (!result.includes(dep)) {
      result.push(dep)
    }
  }
  return result
}
