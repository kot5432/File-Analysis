import React, { useState } from 'react';
import './App.css';
import { analyzeNestingDepth } from './lib/analysis/nesting';
import { analyzeCommentRatio } from './lib/analysis/commentRatio';
import { analyzeFileSize } from './lib/analysis/fileSize';
import { detectUnusedFunctions } from './lib/analysis/unusedFunctions';
import { estimateAIGenerated } from './lib/analysis/aiEstimation';
import { calculateBlackboxRisk } from './lib/analysis/blackboxRisk';
import { RiskGauge } from './components/RiskGauge';
import { analyzeTechStack } from './lib/analysis/techStack';
import { resolveImport, extractDependencies } from './lib/analysis/importResolver';

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

interface BlackboxRisk {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  breakdown: RiskBreakdown;
  nestingDepth?: {
    maxDepth: number;
    riskScore: number;
  };
  commentRatio?: {
    commentRatio: number;
    riskScore: number;
    commentLines: number;
    totalLines: number;
  };
  fileSize?: {
    lineCount: number;
    riskScore: number;
  };
  unusedFunctions?: {
    unusedFunctions: string[];
    count: number;
    riskScore: number;
  };
  aiEstimation?: {
    aiLikelihood: number;
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    reasons: string[];
  };
}

interface RiskBreakdown {
  fileSize: number;
  functionLength: number;
  nestingDepth: number;
  commentRate: number;
  unusedCode: number;
  typeSafety: number;
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
}

interface CodeStructure {
  functions: string[];
  classes: string[];
  imports: string[];
  exports: string[];
}

interface Summary {
  languages: { [key: string]: number };
  technologies: { [key: string]: number };
  totalSize: number;
  totalLines: number;
  averageFileSize: number;
  techStack?: {
    languages: string[];
    frameworks: string[];
    runtime: string[];
    packageManagers: string[];
    buildTools: string[];
  };
  structure?: {
    type: string;
    hasTests: boolean;
    hasCI: boolean;
    componentCount: number;
    apiRoutes: number;
  };
}

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // サポートするファイル拡張子
  const SUPPORTED_EXTENSIONS = [
    // コードファイル
    '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.xml', '.php', '.py', '.java',
    '.cpp', '.c', '.h', '.cs', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.r', '.m',
    '.sh', '.sql', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.md', '.txt',
    // アーカイブ
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.tgz'
  ];

  // ファイルタイプをチェックする関数
  const isSupportedFile = (filename: string): boolean => {
    const ext = '.' + filename.split('.').pop()?.toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
  };

  // ブラックボックスリスク分析関数（新バージョン）
  const analyzeBlackboxRisk = (content: string): BlackboxRisk => {
    // 各専門関数で分析
    const nestingResult = analyzeNestingDepth(content);
    const commentResult = analyzeCommentRatio(content);
    const fileSizeResult = analyzeFileSize(content);
    const unusedFunctionsResult = detectUnusedFunctions(content);
    
    // AI生成確率推定
    const aiResult = estimateAIGenerated({
      commentRatio: commentResult.commentRatio,
      unusedFunctionCount: unusedFunctionsResult.count,
      maxDepth: nestingResult.maxDepth,
      lineCount: fileSizeResult.lineCount
    });
    
    // 総合スコアを計算
    const riskResult = calculateBlackboxRisk({
      nestingScore: nestingResult.riskScore,
      commentScore: commentResult.riskScore,
      fileSizeScore: fileSizeResult.riskScore,
      unusedFunctionsScore: unusedFunctionsResult.riskScore
    });

    return { 
      score: riskResult.blackboxScore, 
      level: riskResult.riskLevel, 
      breakdown: {
        fileSize: riskResult.breakdown.fileSize,
        functionLength: 0, // 今後実装
        nestingDepth: riskResult.breakdown.nesting,
        commentRate: riskResult.breakdown.comments,
        unusedCode: riskResult.breakdown.unusedFunctions, // 新しい指標を使用
        typeSafety: 0 // 今後実装
      },
      nestingDepth: nestingResult,
      commentRatio: commentResult,
      fileSize: fileSizeResult,
      unusedFunctions: unusedFunctionsResult, // 詳細情報も保持
      aiEstimation: aiResult // AI推定結果も保持
    };
  };

  // 補助関数
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!isSupportedFile(file.name)) {
        setError('サポートされていないファイル形式です。コードファイルまたはアーカイブファイルのみアップロードできます。');
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setError(null);
      setAnalysisResult(null);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      if (!isSupportedFile(file.name)) {
        setError('サポートされていないファイル形式です。コードファイルまたはアーカイブファイルのみアップロードできます。');
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setError(null);
      setAnalysisResult(null);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  // ZIP展開関数
  const extractZipFile = async (file: File): Promise<{ path: string; content: string }[]> => {
    return new Promise((resolve, reject) => {
      const JSZip = require('jszip');
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const zip = new JSZip();
          const contents = await zip.loadAsync(e.target?.result as ArrayBuffer);
          const files: { path: string; content: string }[] = [];
          
          for (const [relativePath, fileData] of Object.entries(contents.files)) {
            // ディレクトリは除外
            if ((fileData as any).dir) continue;
            
            // node_modules と不要なファイルを除外
            if (relativePath.includes('node_modules/') || 
                relativePath.includes('.git/') ||
                relativePath.includes('dist/') ||
                relativePath.includes('build/')) continue;
            
            // サポートされているファイルのみ処理
            const ext = '.' + relativePath.split('.').pop()?.toLowerCase();
            if (isSupportedFile(relativePath)) {
              const content = await (fileData as any).async('string');
              files.push({
                path: relativePath,
                content
              });
            }
          }
          
          resolve(files);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = () => reject(new Error('ファイル読み込みに失敗しました'));
      reader.readAsArrayBuffer(file);
    });
  };

  const analyzeFile = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      // ZIPファイルかチェック
      const isZip = selectedFile.name.toLowerCase().endsWith('.zip');
      
      if (isZip) {
        // ZIP展開して分析
        const extractedFiles = await extractZipFile(selectedFile);
        const fileMap = extractedFiles.reduce((map, file) => {
          const normalized = file.path.replace(/\\/g, "/").replace(/^\.\//, "");
          map[normalized] = file.content;
          return map;
        }, {} as Record<string, string>);
        
        // 各ファイルを分析
        const analyzedFiles = extractedFiles.map(file => {
          const language = detectLanguage(file.path);
          const technologies = detectTechnologies(file.content, language);
          
          // 依存関係を抽出・解決
          const dependencies = extractDependencies(file.content);
          const resolvedDependencies = dependencies
            .map((dep: string) => resolveImport(file.path, dep, fileMap))
            .filter((dep): dep is string => dep !== null);
          
          return {
            fileName: file.path,
            language,
            technologies,
            size: file.content.length,
            lines: file.content.split('\n').length,
            structure: {
              functions: extractFunctions(file.content),
              classes: extractClasses(file.content),
              imports: extractImports(file.content),
              exports: extractExports(file.content)
            },
            dependencies,
            resolvedDependencies
          };
        });
        
        // 集計結果
        const languageCounts: { [key: string]: number } = {};
        const technologyCounts: { [key: string]: number } = {};
        
        analyzedFiles.forEach(file => {
          languageCounts[file.language] = (languageCounts[file.language] || 0) + 1;
          file.technologies.forEach(tech => {
            technologyCounts[tech] = (technologyCounts[tech] || 0) + 1;
          });
        });
        
        const summary = {
          totalFiles: extractedFiles.length,
          totalLines: analyzedFiles.reduce((sum, f) => sum + f.lines, 0),
          totalSize: analyzedFiles.reduce((sum, f) => sum + f.size, 0),
          averageFileSize: Math.round(analyzedFiles.reduce((sum, f) => sum + f.size, 0) / analyzedFiles.length),
          languages: languageCounts,
          technologies: technologyCounts
        };
        
        const result: AnalysisResult = {
          type: 'zip',
          fileName: selectedFile.name,
          totalFiles: extractedFiles.length,
          files: analyzedFiles,
          summary
        };
        
        setAnalysisResult(result);
      } else {
        // 単一ファイル分析（既存処理）
        const content = await selectedFile.text();
        const lines = content.split('\n').length;
        
        const ext = '.' + selectedFile.name.split('.').pop()?.toLowerCase();
        const language = detectLanguage(ext);
        const technologies = detectTechnologies(content, language);
        const blackboxRisk = analyzeBlackboxRisk(content);
        
        const result: AnalysisResult = {
          type: 'single',
          fileName: selectedFile.name,
          language,
          technologies,
          size: selectedFile.size,
          lines,
          blackboxRisk,
          structure: {
            functions: extractFunctions(content),
            classes: extractClasses(content),
            imports: extractImports(content),
            exports: extractExports(content)
          }
        };
        
        setAnalysisResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const detectLanguage = (ext: string): string => {
    const languageMap: { [key: string]: string } = {
      '.js': 'JavaScript',
      '.ts': 'TypeScript',
      '.jsx': 'React JSX',
      '.tsx': 'TypeScript React',
      '.py': 'Python',
      '.java': 'Java',
      '.cpp': 'C++',
      '.c': 'C',
      '.cs': 'C#',
      '.php': 'PHP',
      '.rb': 'Ruby',
      '.go': 'Go',
      '.rs': 'Rust',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
      '.html': 'HTML',
      '.css': 'CSS',
      '.json': 'JSON',
      '.xml': 'XML',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.sql': 'SQL',
      '.sh': 'Shell Script'
    };
    return languageMap[ext] || 'Unknown';
  };

  const detectTechnologies = (content: string, language: string): string[] => {
    const technologies: string[] = [];
    
    // React
    if (content.includes('import React') || content.includes('from "react"')) {
      technologies.push('React');
    }
    
    // Node.js
    if (content.includes('require(') || content.includes('import ')) {
      technologies.push('Node.js');
    }
    
    // TypeScript
    if (language === 'TypeScript' || language === 'TypeScript React') {
      technologies.push('TypeScript');
    }
    
    // Express
    if (content.includes('express') || content.includes('app.get') || content.includes('app.post')) {
      technologies.push('Express.js');
    }
    
    return technologies;
  };

  const extractFunctions = (content: string): string[] => {
    const matches = content.match(/function\s+(\w+)|const\s+(\w+)\s*=.*=>|(\w+)\s*:\s*function/g) || [];
    return matches.map(match => match.replace(/function\s+|const\s+|:\s*function|=>.*/g, '').trim());
  };

  const extractClasses = (content: string): string[] => {
    const matches = content.match(/class\s+(\w+)/g) || [];
    return matches.map(match => match.replace('class ', ''));
  };

  const extractImports = (content: string): string[] => {
    const matches = content.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || [];
    return matches.map(match => match.match(/from\s+['"]([^'"]+)['"]/)?.[1] || '');
  };

  const extractExports = (content: string): string[] => {
    const matches = content.match(/export\s+(default\s+)?(\w+)/g) || [];
    return matches.map(match => match.replace(/export\s+(default\s+)?/, ''));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>コード分析ツール</h1>
        <p>AIコーディングツールのブラックボックス化を解消するファイル分析システム</p>
      </header>

      <main className="App-main">
        <div className="upload-section">
          <div
            className="drop-zone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <div className="drop-zone-content">
              <p>ファイルをここにドラッグ＆ドロップするか、クリックして選択してください</p>
              <input
                type="file"
                onChange={handleFileSelect}
                accept=".js,.jsx,.ts,.tsx,.py,.java,.cpp,.c,.h,.cs,.php,.rb,.go,.rs,.swift,.kt,.scala,.r,.m,.sh,.sql,.html,.css,.scss,.sass,.less,.json,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf,.md,.txt,.zip,.rar,.7z,.tar,.tar.gz,.tgz,.tar.bz2"
                style={{ display: 'none' }}
                id="file-input"
              />
              <label htmlFor="file-input" className="file-select-button">
                ファイルを選択
              </label>
            </div>
          </div>

          {selectedFile && (
            <div className="selected-file">
              <p>選択されたファイル: {selectedFile.name}</p>
              <p>サイズ: {formatFileSize(selectedFile.size)}</p>
              <button
                onClick={analyzeFile}
                disabled={isAnalyzing}
                className="analyze-button"
              >
                {isAnalyzing ? '分析中...' : '分析開始'}
              </button>
            </div>
          )}

          {error && (
            <div className="error-message">
              <p>エラー: {error}</p>
            </div>
          )}
        </div>

        {analysisResult && (
          <div className="results-section">
            <h2>分析結果</h2>
            
            {/* ブラックボックスリスク表示 */}
            {analysisResult.blackboxRisk && (
              <div className="blackbox-risk-section">
                <h3>⚠️ ブラックボックスリスク分析</h3>
                <div className="risk-gauge-container">
                  <RiskGauge 
                    score={analysisResult.blackboxRisk.score}
                    level={analysisResult.blackboxRisk.level}
                  />
                </div>
                
                {/* AI生成確率推定 */}
                {analysisResult.blackboxRisk.aiEstimation && (
                  <div className="ai-estimation-section">
                    <h4>🤖 AI Generated Likelihood: {analysisResult.blackboxRisk.aiEstimation.level} ({analysisResult.blackboxRisk.aiEstimation.aiLikelihood}%)</h4>
                    <div className="ai-signals">
                      <p className="ai-disclaimer">※ This is heuristic estimation, not definitive AI detection.</p>
                      <div className="signals-list">
                        <strong>Signals:</strong>
                        <ul>
                          {analysisResult.blackboxRisk.aiEstimation.reasons.map((reason, index) => (
                            <li key={index}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="risk-breakdown">
                  <h4>リスク内訳</h4>
                  <div className="breakdown-items">
                    <div className="breakdown-item">
                      <span className="item-label">ファイル肥大</span>
                      <span className="item-score">+{analysisResult.blackboxRisk.breakdown.fileSize}</span>
                    </div>
                    {analysisResult.blackboxRisk.fileSize && (
                      <div className="file-size-detail">
                        <span className="detail-label">
                          行数: {analysisResult.blackboxRisk.fileSize.lineCount}行
                        </span>
                      </div>
                    )}
                    <div className="breakdown-item">
                      <span className="item-label">関数の長さ</span>
                      <span className="item-score">+{analysisResult.blackboxRisk.breakdown.functionLength}</span>
                    </div>
                    <div className="breakdown-item">
                      <span className="item-label">ネスト深度</span>
                      <span className="item-score">+{analysisResult.blackboxRisk.breakdown.nestingDepth}</span>
                    </div>
                    {analysisResult.blackboxRisk.nestingDepth && (
                      <div className="nesting-detail">
                        <span className="detail-label">最大深度: {analysisResult.blackboxRisk.nestingDepth.maxDepth}</span>
                      </div>
                    )}
                    <div className="breakdown-item">
                      <span className="item-label">コメント率</span>
                      <span className="item-score">+{analysisResult.blackboxRisk.breakdown.commentRate}</span>
                    </div>
                    {analysisResult.blackboxRisk.commentRatio && (
                      <div className="comment-detail">
                        <span className="detail-label">
                          コメント率: {(analysisResult.blackboxRisk.commentRatio.commentRatio * 100).toFixed(1)}%
                          ({analysisResult.blackboxRisk.commentRatio.commentLines}/{analysisResult.blackboxRisk.commentRatio.totalLines}行)
                        </span>
                      </div>
                    )}
                    <div className="breakdown-item">
                      <span className="item-label">未使用コード</span>
                      <span className="item-score">+{analysisResult.blackboxRisk.breakdown.unusedCode}</span>
                    </div>
                    {analysisResult.blackboxRisk.unusedFunctions && (
                      <div className="unused-functions-detail">
                        <span className="detail-label">
                          🧹 Dead Code Risk: {analysisResult.blackboxRisk.unusedFunctions.count}個の未使用関数
                        </span>
                        {analysisResult.blackboxRisk.unusedFunctions.unusedFunctions.length > 0 && (
                          <div className="unused-functions-list">
                            {analysisResult.blackboxRisk.unusedFunctions.unusedFunctions.map((func, index) => (
                              <span key={index} className="unused-function-item">{func}()</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="breakdown-item">
                      <span className="item-label">型安全性</span>
                      <span className="item-score">+{analysisResult.blackboxRisk.breakdown.typeSafety}</span>
                    </div>
                      <span className="stat-value">{analysisResult.language}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">ファイルサイズ</span>
                      <span className="stat-value">{formatFileSize(analysisResult.size || 0)}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">行数</span>
                      <span className="stat-value">{analysisResult.lines}</span>
                    </div>
                  </div>
                </div>

                {analysisResult.technologies && analysisResult.technologies.length > 0 && (
                  <div className="technologies-summary">
                    <h3>検出された技術</h3>
                    <div className="tech-tags">
                      {analysisResult.technologies.map((tech: string, index: number) => (
                        <span key={index} className="tech-tag">{tech}</span>
                      ))}
                    </div>
                  </div>
                )}
                
                {analysisResult.structure && (
                  <div className="structure-summary">
                    <h3>コード構造</h3>
                    <div className="structure-stats">
                      <div className="structure-item">
                        <span className="structure-label">関数</span>
                        <span className="structure-count">{analysisResult.structure.functions.length}</span>
                      </div>
                      <div className="structure-item">
                        <span className="structure-label">クラス</span>
                        <span className="structure-count">{analysisResult.structure.classes.length}</span>
                      </div>
                      <div className="structure-item">
                        <span className="structure-label">インポート</span>
                        <span className="structure-count">{analysisResult.structure.imports.length}</span>
                      </div>
                      <div className="structure-item">
                        <span className="structure-label">エクスポート</span>
                        <span className="structure-count">{analysisResult.structure.exports.length}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {analysisResult.type === 'zip' && (
              <div className="summary-stats">
                  <h3>プロジェクト概要</h3>
                  <div className="stats-grid">
                    <div className="stat-item">
                      <span className="stat-label">総ファイル数</span>
                      <span className="stat-value">{analysisResult.totalFiles}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">総サイズ</span>
                      <span className="stat-value">{formatFileSize(analysisResult.summary?.totalSize || 0)}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">総行数</span>
                      <span className="stat-value">{analysisResult.summary?.totalLines}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">平均ファイルサイズ</span>
                      <span className="stat-value">{formatFileSize(analysisResult.summary?.averageFileSize || 0)}</span>
                    </div>
                  </div>
                </div>

                {analysisResult.summary && (
                  <>
                    <div className="languages-summary">
                      <h3>使用言語</h3>
                      <div className="language-stats">
                        {Object.entries(analysisResult.summary.languages)
                          .sort(([,a], [,b]) => b - a)
                          .map(([lang, count]) => (
                            <div key={lang} className="language-item">
                              <span className="language-name">{lang}</span>
                              <span className="language-count">{count}ファイル</span>
                              <div className="language-bar">
                                <div 
                                  className="language-bar-fill" 
                                  style={{width: `${(count / analysisResult.totalFiles!) * 100}%`}}
                                />
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                    
                    <div className="technologies-summary">
                      <h3>検出された技術</h3>
                      <div className="tech-tags">
                        {Object.entries(analysisResult.summary.technologies)
                          .sort(([,a], [,b]) => b - a)
                          .map(([tech, count]) => (
                            <span key={tech} className="tech-tag">
                              {tech} ({count})
                            </span>
                          ))}
                      </div>
                    </div>
                  </>
                )}

                {analysisResult.files && analysisResult.files.length > 0 && (
                  <div className="important-files">
                    <h3>主要ファイル</h3>
                    <div className="files-grid">
                      {analysisResult.files
                        .sort((a, b) => b.size - a.size)
                        .slice(0, 10)
                        .map((file, index) => (
                          <div key={index} className="file-card">
                            <h4>{file.fileName}</h4>
                            <div className="file-meta">
                              <span className="file-language">{file.language}</span>
                              <span className="file-size">{formatFileSize(file.size)}</span>
                              <span className="file-lines">{file.lines}行</span>
                            </div>
                            {file.technologies.length > 0 && (
                              <div className="file-tech-tags">
                                {file.technologies.slice(0, 3).map((tech, techIndex) => (
                                  <span key={techIndex} className="mini-tech-tag">{tech}</span>
                                ))}
                                {file.technologies.length > 3 && (
                                  <span className="more-tech">+{file.technologies.length - 3}</span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                    {analysisResult.files.length > 10 && (
                      <p className="more-files">他{analysisResult.files.length - 10}ファイル...</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
