type FileMap = Record<string, string>

export function buildFileMap(
  files: { path: string; content: string }[]
): FileMap {
  const map: FileMap = {}

  for (const file of files) {
    // 正規化（超重要）
    const normalized = file.path
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")

    map[normalized] = file.content
  }

  return map
}
