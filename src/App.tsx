import React, { useState } from 'react';
import './App.css';

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

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
      setAnalysisResult(null);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
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

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('http://localhost:5000/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('分析に失敗しました');
      }

      const result = await response.json();
      setAnalysisResult(result.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setIsAnalyzing(false);
    }
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
                accept=".js,.jsx,.ts,.tsx,.py,.java,.cpp,.c,.cs,.php,.rb,.go,.rs,.swift,.kt,.html,.css,.scss,.sass,.less,.json,.xml,.yaml,.yml,.md,.sql,.sh,.vue,.svelte,.zip,.rar,.7z,.tar,.tar.gz,.tgz,.tar.bz2"
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
