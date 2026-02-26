import React, { useState } from 'react';
import './App.css';
import { analyzeNestingDepth } from './lib/analysis/nesting';

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

  // ブラックボックスリスク分析関数
  const analyzeBlackboxRisk = (content: string, lines: number): BlackboxRisk => {
    // ネスト深度分析
    const nestingResult = analyzeNestingDepth(content);
    
    const breakdown: RiskBreakdown = {
      fileSize: calculateFileSizeRisk(lines),
      functionLength: calculateFunctionLengthRisk(content),
      nestingDepth: nestingResult.riskScore, // 新しい関数を使用
      commentRate: calculateCommentRateRisk(content, lines),
      unusedCode: calculateUnusedCodeRisk(content),
      typeSafety: calculateTypeSafetyRisk(content)
    };

    const totalScore = Object.values(breakdown).reduce((sum, score) => sum + score, 0);
    const level = totalScore >= 70 ? 'HIGH' : totalScore >= 40 ? 'MEDIUM' : 'LOW';

    return { 
      score: totalScore, 
      level, 
      breakdown,
      nestingDepth: nestingResult // 詳細情報も保持
    };
  };

  // 各リスク要因の計算関数
  const calculateFileSizeRisk = (lines: number): number => {
    if (lines > 1000) return 20;
    if (lines > 500) return 10;
    return 0;
  };

  const calculateCommentRateRisk = (content: string, totalLines: number): number => {
    const commentLines = content.split('\n').filter(line => 
      line.trim().startsWith('//') || 
      line.trim().startsWith('/*') || 
      line.trim().startsWith('*') ||
      line.trim().startsWith('#') ||
      line.trim().match(/\/\*.*\*\//)
    ).length;
    
    const commentRate = commentLines / totalLines;
    
    if (commentRate < 0.05) return 15;
    if (commentRate < 0.10) return 8;
    return 0;
  };

  const calculateFunctionLengthRisk = (content: string): number => {
    const functions = content.match(/function\s+\w+|=>\s*{|\w+\s*:\s*function/g) || [];
    
    // 簡易的な関数長計算（MVP）
    const avgLength = functions.length > 0 ? Math.floor(content.split('\n').length / functions.length) : 0;
    
    if (avgLength > 50) return 20;
    if (avgLength > 30) return 10;
    return 0;
  };

  const calculateUnusedCodeRisk = (content: string): number => {
    // 簡易的な未使用関数検出（MVP）
    const functionNames = content.match(/function\s+(\w+)|const\s+(\w+)\s*=/g) || [];
    return functionNames.length > 10 ? 10 : 5;
  };

  const calculateTypeSafetyRisk = (content: string): number => {
    const anyCount = (content.match(/: any/g) || []).length;
    const totalTypes = (content.match(/: \w+/g) || []).length;
    
    if (totalTypes === 0) return 0;
    const anyRate = anyCount / totalTypes;
    
    return anyRate > 0.3 ? 10 : anyRate > 0.1 ? 5 : 0;
  };

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

  const analyzeFile = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      // ファイル内容を読み込んで分析
      const content = await selectedFile.text();
      const lines = content.split('\n').length;
      
      // 言語検出
      const ext = '.' + selectedFile.name.split('.').pop()?.toLowerCase();
      const language = detectLanguage(ext);
      
      // 技術スタック検出
      const technologies = detectTechnologies(content, language);
      
      // ブラックボックスリスク分析
      const blackboxRisk = analyzeBlackboxRisk(content, lines);
      
      // 結果を設定
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 補助関数
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
                  <div className="risk-gauge">
                    <div className={`risk-score ${analysisResult.blackboxRisk.level.toLowerCase()}`}>
                      <div className="risk-number">{analysisResult.blackboxRisk.score}</div>
                      <div className="risk-label">Blackbox Risk</div>
                    </div>
                    <div className="risk-level">
                      <span className={`level-badge ${analysisResult.blackboxRisk.level.toLowerCase()}`}>
                        {analysisResult.blackboxRisk.level}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="risk-breakdown">
                  <h4>リスク内訳</h4>
                  <div className="breakdown-items">
                    <div className="breakdown-item">
                      <span className="item-label">ファイル肥大</span>
                      <span className="item-score">+{analysisResult.blackboxRisk.breakdown.fileSize}</span>
                    </div>
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
                    <div className="breakdown-item">
                      <span className="item-label">未使用コード</span>
                      <span className="item-score">+{analysisResult.blackboxRisk.breakdown.unusedCode}</span>
                    </div>
                    <div className="breakdown-item">
                      <span className="item-label">型安全性</span>
                      <span className="item-score">+{analysisResult.blackboxRisk.breakdown.typeSafety}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {analysisResult.type === 'single' ? (
              <div className="summary-result">
                <div className="summary-stats">
                  <h3>プロジェクト概要</h3>
                  <div className="stats-grid">
                    <div className="stat-item">
                      <span className="stat-label">言語</span>
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
                      {analysisResult.technologies.map((tech, index) => (
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
            ) : (
              <div className="summary-result">
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
