import React, { useState } from 'react';
import './App.css';
import { analyzeNestingDepth } from './lib/analysis/nesting';
import { analyzeCommentRatio } from './lib/analysis/commentRatio';
import { analyzeFileSize } from './lib/analysis/fileSize';
import { detectUnusedFunctions } from './lib/analysis/unusedFunctions';
import { estimateAIGenerated } from './lib/analysis/aiEstimation';
import { calculateBlackboxRisk } from './lib/analysis/blackboxRisk';
import { RiskGauge } from './components/RiskGauge';
import { resolveImport, extractDependencies } from './lib/analysis/importResolver';

// --- Types & Interfaces ---

interface CodeStructure {
  functions: string[];
  classes: string[];
  imports: string[];
  exports: string[];
}

interface RiskBreakdown {
  fileSize: number;
  functionLength: number;
  nestingDepth: number;
  commentRate: number;
  unusedCode: number;
  typeSafety: number;
}

interface BlackboxRisk {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  breakdown: RiskBreakdown;
  nestingDepth?: { maxDepth: number; riskScore: number };
  commentRatio?: { commentRatio: number; riskScore: number; commentLines: number; totalLines: number };
  fileSize?: { lineCount: number; riskScore: number };
  unusedFunctions?: { unusedFunctions: string[]; count: number; riskScore: number };
  aiEstimation?: { aiLikelihood: number; level: 'LOW' | 'MEDIUM' | 'HIGH'; reasons: string[] };
}

interface FileAnalysis {
  fileName: string;
  language: string;
  technologies: string[];
  size: number;
  lines: number;
  structure: CodeStructure;
  dependencies?: string[];
  resolvedDependencies?: string[];
  blackboxRisk?: BlackboxRisk;
}

interface Summary {
  languages: { [key: string]: number };
  technologies: { [key: string]: number };
  totalSize: number;
  totalLines: number;
  averageFileSize: number;
}

interface AnalysisResult {
  type: 'single' | 'zip';
  fileName?: string;
  totalFiles?: number;
  files?: FileAnalysis[];
  summary?: Summary;
  language?: string;
  technologies?: string[];
  size?: number;
  lines?: number;
  structure?: CodeStructure;
  blackboxRisk?: BlackboxRisk;
}

// --- Utils ---

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const detectLanguage = (path: string): string => {
  const ext = '.' + path.split('.').pop()?.toLowerCase();
  const languageMap: { [key: string]: string } = {
    '.js': 'JavaScript', '.ts': 'TypeScript', '.jsx': 'React JSX', '.tsx': 'TypeScript React',
    '.py': 'Python', '.java': 'Java', '.cpp': 'C++', '.c': 'C', '.cs': 'C#', '.php': 'PHP',
    '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust', '.swift': 'Swift', '.kt': 'Kotlin',
    '.html': 'HTML', '.css': 'CSS', '.json': 'JSON', '.xml': 'XML', '.yaml': 'YAML',
    '.yml': 'YAML', '.sql': 'SQL', '.sh': 'Shell Script'
  };
  return languageMap[ext] || 'Unknown';
};

const detectTechnologies = (content: string, language: string): string[] => {
  const techs: string[] = [];
  if (content.includes('import React') || content.includes('from "react"')) techs.push('React');
  if (content.includes('require(') || content.includes('import ')) techs.push('Node.js');
  if (language.includes('TypeScript')) techs.push('TypeScript');
  if (content.includes('express') || content.includes('app.get')) techs.push('Express.js');
  return techs;
};

const extractFunctions = (content: string): string[] => {
  const matches = content.match(/function\s+(\w+)|const\s+(\w+)\s*=.*=>|(\w+)\s*:\s*function/g) || [];
  return matches.map(m => m.replace(/function\s+|const\s+|:\s*function|=>.*/g, '').trim());
};

const extractClasses = (content: string): string[] => (content.match(/class\s+(\w+)/g) || []).map(m => m.replace('class ', ''));
const extractImports = (content: string): string[] => (content.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || []).map(m => m.match(/from\s+['"]([^'"]+)['"]/)?.[1] || '');
const extractExports = (content: string): string[] => (content.match(/export\s+(default\s+)?(\w+)/g) || []).map(m => m.replace(/export\s+(default\s+)?/, ''));

// --- Sub-components ---

const RiskBadge: React.FC<{ risk?: BlackboxRisk }> = ({ risk }) => {
  if (!risk) return null;
  const color = risk.level === 'HIGH' ? '#ff4d4f' : risk.level === 'MEDIUM' ? '#faad14' : '#52c41a';
  const label = risk.level === 'HIGH' ? '🔴 HIGH Risk' : risk.level === 'MEDIUM' ? '🟡 MEDIUM Risk' : '🟢 LOW Risk';
  return (
    <span className="risk-mini-badge" style={{ backgroundColor: color, color: '#fff', fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', marginLeft: '8px', fontWeight: 'bold' }}>
      {label}
    </span>
  );
};

const RiskAnalysisView: React.FC<{ risk: BlackboxRisk }> = ({ risk }) => (
  <div className="blackbox-risk-section">
    <h3>⚠️ ブラックボックスリスク分析</h3>
    <div className="risk-gauge-container">
      <RiskGauge score={risk.score} level={risk.level} />
    </div>

    {risk.aiEstimation && (
      <div className="ai-estimation-section">
        <h4>🤖 AI Generated Likelihood: {risk.aiEstimation.level} ({risk.aiEstimation.aiLikelihood}%)</h4>
        <div className="ai-signals">
          <p className="ai-disclaimer">※ This is heuristic estimation, not definitive AI detection.</p>
          <div className="signals-list">
            <strong>Signals:</strong>
            <ul>{risk.aiEstimation.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        </div>
      </div>
    )}

    <div className="risk-breakdown">
      <h4>リスク内訳</h4>
      <div className="breakdown-items">
        <div className="breakdown-item">
          <span className="item-label">ファイル肥大</span>
          <span className="item-score">+{risk.breakdown.fileSize}</span>
        </div>
        {risk.fileSize && <div className="file-size-detail"><span className="detail-label">行数: {risk.fileSize.lineCount}行</span></div>}

        <div className="breakdown-item"><span className="item-label">関数の長さ</span><span className="item-score">+{risk.breakdown.functionLength}</span></div>

        <div className="breakdown-item"><span className="item-label">ネスト深度</span><span className="item-score">+{risk.breakdown.nestingDepth}</span></div>
        {risk.nestingDepth && <div className="nesting-detail"><span className="detail-label">最大深度: {risk.nestingDepth.maxDepth}</span></div>}

        <div className="breakdown-item"><span className="item-label">コメント率</span><span className="item-score">+{risk.breakdown.commentRate}</span></div>
        {risk.commentRatio && (
          <div className="comment-detail">
            <span className="detail-label">
              コメント率: {(risk.commentRatio.commentRatio * 100).toFixed(1)}% ({risk.commentRatio.commentLines}/{risk.commentRatio.totalLines}行)
            </span>
          </div>
        )}

        <div className="breakdown-item"><span className="item-label">未使用コード</span><span className="item-score">+{risk.breakdown.unusedCode}</span></div>
        {risk.unusedFunctions && (
          <div className="unused-functions-detail">
            <span className="detail-label">🧹 Dead Code Risk: {risk.unusedFunctions.count}個の未使用関数</span>
            {risk.unusedFunctions.unusedFunctions.length > 0 && (
              <div className="unused-functions-list">
                {risk.unusedFunctions.unusedFunctions.map((f, i) => <span key={i} className="unused-function-item">{f}()</span>)}
              </div>
            )}
          </div>
        )}
        <div className="breakdown-item"><span className="item-label">型安全性</span><span className="item-score">+{risk.breakdown.typeSafety}</span></div>
      </div>
    </div>
  </div>
);

const StructureStats: React.FC<{ structure: CodeStructure }> = ({ structure }) => (
  <div className="structure-summary">
    <h3>コード構造</h3>
    <div className="structure-stats">
      <div className="structure-item"><span className="structure-label">関数</span><span className="structure-count">{structure.functions.length}</span></div>
      <div className="structure-item"><span className="structure-label">クラス</span><span className="structure-count">{structure.classes.length}</span></div>
      <div className="structure-item"><span className="structure-label">インポート</span><span className="structure-count">{structure.imports.length}</span></div>
      <div className="structure-item"><span className="structure-label">エクスポート</span><span className="structure-count">{structure.exports.length}</span></div>
    </div>
  </div>
);

const HighRiskSummary: React.FC<{ files: FileAnalysis[]; onSelect: (f: FileAnalysis) => void }> = ({ files, onSelect }) => {
  const highRiskFiles = files
    .filter(f => f.blackboxRisk?.level === 'HIGH')
    .sort((a, b) => (b.blackboxRisk?.score || 0) - (a.blackboxRisk?.score || 0));

  if (highRiskFiles.length === 0) return null;

  const getRiskReason = (risk: BlackboxRisk) => {
    if (risk.aiEstimation && risk.aiEstimation.aiLikelihood > 70) return "AI生成の可能性が高い";
    if (risk.nestingDepth && risk.nestingDepth.maxDepth > 5) return "コードの複雑度が高い";
    if (risk.fileSize && risk.fileSize.lineCount > 500) return "ファイルが肥大化しています";
    if (risk.unusedFunctions && risk.unusedFunctions.count > 5) return "未使用コード（死んだコード）が多い";
    return "総合的な複雑性が高い";
  };

  return (
    <div className="high-risk-summary" style={{ backgroundColor: '#fff1f0', border: '1px solid #ffa39e', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
      <h3 style={{ color: '#cf1322', marginTop: 0 }}>🚨 ハイリスク・ファイル検知 ({highRiskFiles.length}件)</h3>
      <p style={{ fontSize: '0.9rem', marginBottom: '12px' }}>複雑性が高く、AI生成の可能性が高い、または修正が困難な可能性のあるファイルです：</p>
      <div className="high-risk-list">
        {highRiskFiles.slice(0, 3).map((file, i) => (
          <div key={i} onClick={() => onSelect(file)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < 2 && i < highRiskFiles.length - 1 ? '1px solid #ffccc7' : 'none', cursor: 'pointer' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{file.fileName}</span>
              <span style={{ fontSize: '0.75rem', color: '#cf1322' }}>{file.blackboxRisk ? getRiskReason(file.blackboxRisk) : ""}</span>
            </div>
            <span style={{ color: '#cf1322', fontWeight: 'bold' }}>Score: {file.blackboxRisk?.score}</span>
          </div>
        ))}
      </div>
      {highRiskFiles.length > 3 && (
        <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '8px', textAlign: 'right' }}>他 {highRiskFiles.length - 3} 件のハイリスクファイル...</p>
      )}
    </div>
  );
};

const FileGrid: React.FC<{ files: FileAnalysis[]; onSelect: (f: FileAnalysis) => void }> = ({ files, onSelect }) => (
  <div className="important-files">
    <h3>主要ファイル</h3>
    <div className="files-grid">
      {files.sort((a, b) => b.size - a.size).slice(0, 10).map((file, i) => (
        <div key={i} className="file-card" onClick={() => onSelect(file)} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{file.fileName}</h4>
            <RiskBadge risk={file.blackboxRisk} />
          </div>
          <div className="file-meta">
            <span className="file-language">{file.language}</span>
            <span className="file-size">{formatFileSize(file.size)}</span>
            <span className="file-lines">{file.lines}行</span>
          </div>
          {file.technologies.length > 0 && (
            <div className="file-tech-tags">
              {file.technologies.slice(0, 3).map((t, ti) => <span key={ti} className="mini-tech-tag">{t}</span>)}
              {file.technologies.length > 3 && <span className="more-tech">+{file.technologies.length - 3}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
    {files.length > 10 && <p className="more-files">他{files.length - 10}ファイル...</p>}
  </div>
);

// --- Main App Component ---

const FileDetailView: React.FC<{ file: FileAnalysis; onBack: () => void }> = ({ file, onBack }) => (
  <div className="file-detail-view" style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
    <button onClick={onBack} style={{ marginBottom: '16px', background: 'none', border: 'none', color: '#4a90e2', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center' }}>
      ← 一覧に戻る
    </button>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{file.fileName}</h2>
        <div style={{ marginTop: '8px', color: '#666' }}>
          <span>{file.language}</span> • <span>{formatFileSize(file.size)}</span> • <span>{file.lines}行</span>
        </div>
      </div>
      <RiskBadge risk={file.blackboxRisk} />
    </div>

    {file.blackboxRisk && <RiskAnalysisView risk={file.blackboxRisk} />}
    <StructureStats structure={file.structure} />

    {file.technologies.length > 0 && (
      <div className="technologies-summary" style={{ marginTop: '24px' }}>
        <h3>検出された技術</h3>
        <div className="tech-tags">
          {file.technologies.map((t, i) => <span key={i} className="tech-tag">{t}</span>)}
        </div>
      </div>
    )}
  </div>
);

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileInZip, setSelectedFileInZip] = useState<FileAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const SUPPORTED_EXTENSIONS = [
    '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.xml', '.php', '.py', '.java',
    '.cpp', '.c', '.h', '.cs', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.r', '.m',
    '.sh', '.sql', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.md', '.txt',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.tgz'
  ];

  const isSupportedFile = (name: string) => SUPPORTED_EXTENSIONS.includes('.' + name.split('.').pop()?.toLowerCase());

  const analyzeBlackboxRisk = (content: string): BlackboxRisk => {
    const nesting = analyzeNestingDepth(content);
    const comment = analyzeCommentRatio(content);
    const size = analyzeFileSize(content);
    const unused = detectUnusedFunctions(content);
    const ai = estimateAIGenerated({ commentRatio: comment.commentRatio, unusedFunctionCount: unused.count, maxDepth: nesting.maxDepth, lineCount: size.lineCount });
    const risk = calculateBlackboxRisk({ nestingScore: nesting.riskScore, commentScore: comment.riskScore, fileSizeScore: size.riskScore, unusedFunctionsScore: unused.riskScore });

    return {
      score: risk.blackboxScore,
      level: risk.riskLevel,
      breakdown: { fileSize: risk.breakdown.fileSize, functionLength: 0, nestingDepth: risk.breakdown.nesting, commentRate: risk.breakdown.comments, unusedCode: risk.breakdown.unusedFunctions, typeSafety: 0 },
      nestingDepth: nesting,
      commentRatio: comment,
      fileSize: size,
      unusedFunctions: unused,
      aiEstimation: ai
    };
  };

  const extractZipFile = async (file: File): Promise<{ path: string; content: string }[]> => {
    const JSZip = require('jszip');
    const zip = new JSZip();
    const data = await file.arrayBuffer();
    const contents = await zip.loadAsync(data);
    const files: { path: string; content: string }[] = [];

    for (const [path, fileData] of Object.entries(contents.files)) {
      if ((fileData as any).dir) continue;
      if (['node_modules/', '.git/', 'dist/', 'build/'].some(p => path.includes(p))) continue;
      if (isSupportedFile(path)) {
        files.push({ path, content: await (fileData as any).async('string') });
      }
    }
    return files;
  };

  const analyzeFile = async () => {
    if (!selectedFile) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      if (selectedFile.name.toLowerCase().endsWith('.zip')) {
        const extracted = await extractZipFile(selectedFile);
        const fileMap = extracted.reduce((m, f) => ({ ...m, [f.path.replace(/\\/g, "/").replace(/^\.\//, "")]: f.content }), {} as Record<string, string>);

        const analyzed = extracted.map(f => {
          const lang = detectLanguage(f.path);
          const content = f.content;
          return {
            fileName: f.path, language: lang, technologies: detectTechnologies(content, lang),
            size: content.length, lines: content.split('\n').length,
            structure: { functions: extractFunctions(content), classes: extractClasses(content), imports: extractImports(content), exports: extractExports(content) },
            dependencies: extractDependencies(content),
            resolvedDependencies: extractDependencies(content).map(d => resolveImport(f.path, d, fileMap)).filter((d): d is string => d !== null),
            blackboxRisk: analyzeBlackboxRisk(content)
          };
        });

        const langCounts: Record<string, number> = {};
        const techCounts: Record<string, number> = {};
        analyzed.forEach(f => {
          langCounts[f.language] = (langCounts[f.language] || 0) + 1;
          f.technologies.forEach(t => { techCounts[t] = (techCounts[t] || 0) + 1; });
        });

        setAnalysisResult({
          type: 'zip', fileName: selectedFile.name, totalFiles: extracted.length, files: analyzed,
          summary: {
            languages: langCounts, technologies: techCounts, totalLines: analyzed.reduce((s, f) => s + f.lines, 0),
            totalSize: analyzed.reduce((s, f) => s + f.size, 0), averageFileSize: Math.round(analyzed.reduce((s, f) => s + f.size, 0) / analyzed.length)
          }
        });
      } else {
        const content = await selectedFile.text();
        const lang = detectLanguage(selectedFile.name);
        setAnalysisResult({
          type: 'single', fileName: selectedFile.name, language: lang, technologies: detectTechnologies(content, lang),
          size: selectedFile.size, lines: content.split('\n').length, blackboxRisk: analyzeBlackboxRisk(content),
          structure: { functions: extractFunctions(content), classes: extractClasses(content), imports: extractImports(content), exports: extractExports(content) }
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>コード分析ツール</h1>
        <p>AIコーディングツールのブラックボックス化を解消するファイル分析システム</p>
      </header>

      <main className="App-main">
        <div className="upload-section">
          <div className="drop-zone" onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && isSupportedFile(f.name)) { setSelectedFile(f); setError(null); setAnalysisResult(null); } else { setError('Unsupported file'); } }} onDragOver={(e) => e.preventDefault()}>
            <div className="drop-zone-content">
              <p>ファイルをここにドラッグ＆ドロップするか、クリックして選択してください</p>
              <input type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f && isSupportedFile(f.name)) { setSelectedFile(f); setError(null); setAnalysisResult(null); } else if (f) { setError('Unsupported file'); } }} style={{ display: 'none' }} id="file-input" />
              <label htmlFor="file-input" className="file-select-button">ファイルを選択</label>
            </div>
          </div>

          {selectedFile && (
            <div className="selected-file">
              <p>選択されたファイル: {selectedFile.name}</p>
              <p>サイズ: {formatFileSize(selectedFile.size)}</p>
              <button onClick={analyzeFile} disabled={isAnalyzing} className="analyze-button">{isAnalyzing ? '分析中...' : '分析開始'}</button>
            </div>
          )}
          {error && <div className="error-message"><p>エラー: {error}</p></div>}
        </div>

        {analysisResult && (
          <div className="results-section">
            <h2>分析結果</h2>
            {analysisResult.blackboxRisk && <RiskAnalysisView risk={analysisResult.blackboxRisk} />}

            <div className="summary-result">
              <div className="summary-stats">
                <h3>{analysisResult.type === 'zip' ? 'プロジェクト概要' : 'ファイル概要'}</h3>
                <div className="stats-grid">
                  {analysisResult.type === 'zip' ? (
                    <>
                      <div className="stat-item"><span className="stat-label">総ファイル数</span><span className="stat-value">{analysisResult.totalFiles}</span></div>
                      <div className="stat-item"><span className="stat-label">総サイズ</span><span className="stat-value">{formatFileSize(analysisResult.summary?.totalSize || 0)}</span></div>
                      <div className="stat-item"><span className="stat-label">総行数</span><span className="stat-value">{analysisResult.summary?.totalLines}</span></div>
                    </>
                  ) : (
                    <>
                      <div className="stat-item"><span className="stat-label">言語</span><span className="stat-value">{analysisResult.language}</span></div>
                      <div className="stat-item"><span className="stat-label">サイズ</span><span className="stat-value">{formatFileSize(analysisResult.size || 0)}</span></div>
                      <div className="stat-item"><span className="stat-label">行数</span><span className="stat-value">{analysisResult.lines}</span></div>
                    </>
                  )}
                </div>
              </div>

              {analysisResult.type === 'zip' && analysisResult.summary && (
                <>
                  <div className="languages-summary">
                    <h3>使用言語</h3>
                    <div className="language-stats">
                      {Object.entries(analysisResult.summary.languages).sort(([, a], [, b]) => b - a).map(([lang, count]) => (
                        <div key={lang} className="language-item">
                          <span className="language-name">{lang}</span>
                          <span className="language-count">{count}ファイル</span>
                          <div className="language-bar"><div className="language-bar-fill" style={{ width: `${(count / (analysisResult.totalFiles || 1)) * 100}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="technologies-summary">
                    <h3>検出された技術</h3>
                    <div className="tech-tags">
                      {Object.entries(analysisResult.summary.technologies).sort(([, a], [, b]) => b - a).map(([tech, count]) => <span key={tech} className="tech-tag">{tech} ({count})</span>)}
                    </div>
                  </div>
                </>
              )}

              {analysisResult.type === 'single' && analysisResult.technologies && analysisResult.technologies.length > 0 && (
                <div className="technologies-summary">
                  <h3>検出された技術</h3>
                  <div className="tech-tags">{analysisResult.technologies.map((t, i) => <span key={i} className="tech-tag">{t}</span>)}</div>
                </div>
              )}

              {analysisResult.structure && <StructureStats structure={analysisResult.structure} />}
              {analysisResult.files && (
                <>
                  {selectedFileInZip ? (
                    <FileDetailView file={selectedFileInZip} onBack={() => setSelectedFileInZip(null)} />
                  ) : (
                    <>
                      <HighRiskSummary files={analysisResult.files} onSelect={setSelectedFileInZip} />
                      <FileGrid files={analysisResult.files} onSelect={setSelectedFileInZip} />
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
