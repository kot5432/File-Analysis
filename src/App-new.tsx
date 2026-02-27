import React, { useState } from 'react';

// --- 型定義 ---
interface FileAnalysis {
  fileName: string;
  language: string;
  size: number;
  lines: number;
  blackboxRisk?: {
    score: number;
    level: string;
  };
  technologies: string[];
}

interface AnalysisResult {
  type: 'zip' | 'single';
  totalFiles?: number;
  files?: FileAnalysis[];
  blackboxRisk?: {
    score: number;
    aiEstimation?: {
      aiLikelihood: number;
    };
  };
  summary?: {
    totalSize?: number;
    totalLines?: number;
  };
}

// --- 統一リスクレベル判定関数 ---
const getRiskLevel = (score: number): { level: 'LOW' | 'MEDIUM' | 'HIGH', color: string, icon: string } => {
  if (score >= 70) {
    return { level: 'HIGH', color: '#dc2626', icon: '🔴' };
  } else if (score >= 40) {
    return { level: 'MEDIUM', color: '#f59e0b', icon: '🟡' };
  } else {
    return { level: 'LOW', color: '#10b981', icon: '🟢' };
  }
};

// --- BBI計算関数 ---
const calculateBlackBoxIndex = (analysis: AnalysisResult) => {
  if (!analysis.files || analysis.files.length === 0) {
    return { score: 0, level: 'HEALTHY' as any };
  }
  
  const avgRisk = analysis.files.reduce((sum, file) => sum + (file.blackboxRisk?.score || 0), 0) / analysis.files.length;
  const aiLikelihood = analysis.blackboxRisk?.aiEstimation?.aiLikelihood || 0;
  
  return {
    score: Math.round(avgRisk),
    level: avgRisk >= 70 ? 'CRITICAL' : avgRisk >= 40 ? 'WARNING' : 'HEALTHY',
    contributions: {
      avgRisk: {
        value: Math.round(avgRisk),
        weight: 35,
        contribution: Math.round(0.35 * avgRisk),
        description: '平均リスクスコア'
      },
      aiSuspiciousRatio: {
        value: Math.round(aiLikelihood),
        weight: 10,
        contribution: Math.round(0.10 * aiLikelihood),
        description: 'AI生成疑い率'
      }
    }
  };
};

// --- BBIカードコンポーネント ---
const BBICard: React.FC<{ analysis: AnalysisResult }> = ({ analysis }) => {
  const bbi = calculateBlackBoxIndex(analysis);
  const { level, color } = getRiskLevel(bbi.score);
  const aiLikelihood = analysis.blackboxRisk?.aiEstimation?.aiLikelihood || 0;
  
  return (
    <div style={{
      backgroundColor: '#fff7e6',
      border: '1px solid #fbbf24',
      borderRadius: '8px',
      padding: '16px',
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      position: 'relative'
    }}>
      <div style={{ fontSize: '12px', color: '#595959', marginBottom: '8px', fontWeight: '500' }}>
        🎯 プロジェクトリスク概要
      </div>
      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#d97706', marginBottom: '8px' }}>
        {bbi.score}
      </div>
      <div style={{ 
        fontSize: '12px', 
        fontWeight: '600', 
        backgroundColor: '#d97706',
        color: 'white',
        padding: '4px 8px',
        borderRadius: '4px',
        marginBottom: '8px',
        display: 'inline-block'
      }}>
        {bbi.score >= 70 ? '🔴 高リスク' : bbi.score >= 40 ? '🟡 要注意' : '🟢 健全'}
      </div>
      
      <div style={{ fontSize: '11px', color: '#666', lineHeight: '1.4', marginBottom: '8px' }}>
        {bbi.score >= 70 ? '🔴 複雑化が進んでいます。リファクタリングを優先してください。' : 
         bbi.score >= 40 ? '🟡 一部改善が必要です。高リスクファイルから確認してください。' : 
         '🟢 プロジェクトは健全な状態です。現在の品質を維持してください。'}
      </div>
      
      <div style={{ fontSize: '10px', color: '#666', lineHeight: '1.2' }}>
        💡 最も影響している要因: {bbi.contributions && Object.entries(bbi.contributions)
          .sort((a, b) => b[1].contribution - a[1].contribution)[0]?.[1]?.description || '平均リスク'}
      </div>
      
      {aiLikelihood >= 70 && (
        <div style={{ 
          fontSize: '9px', 
          color: '#d97706', 
          marginTop: '8px',
          backgroundColor: '#fef3c7',
          border: '1px solid #fbbf24',
          borderRadius: '4px',
          padding: '4px'
        }}>
          ⚠️ AI生成コードの可能性があります
        </div>
      )}
      
      <div style={{ 
        position: 'absolute', 
        top: '8px', 
        right: '8px', 
        fontSize: '10px', 
        color: '#999',
        opacity: 0.7
      }}>
        🔍
      </div>
    </div>
  );
};

// --- ファイルグリッドコンポーネント ---
const FileGrid: React.FC<{ files: FileAnalysis[]; onSelect: (f: FileAnalysis) => void }> = ({ files, onSelect }) => {
  const [sortBy, setSortBy] = useState<'risk' | 'size' | 'lines'>('risk');
  
  const getSortedFiles = () => {
    const sorted = [...files];
    switch (sortBy) {
      case 'risk':
        return sorted.sort((a, b) => (b.blackboxRisk?.score || 0) - (a.blackboxRisk?.score || 0));
      case 'size':
        return sorted.sort((a, b) => b.size - a.size);
      case 'lines':
        return sorted.sort((a, b) => b.lines - a.lines);
      default:
        return sorted;
    }
  };

  return (
    <div className="important-files">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0 }}>主要ファイル</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setSortBy('risk')}
            style={{
              padding: '4px 8px',
              fontSize: '12px',
              border: `1px solid ${sortBy === 'risk' ? '#1890ff' : '#d9d9d9'}`,
              backgroundColor: sortBy === 'risk' ? '#1890ff' : '#fff',
              color: sortBy === 'risk' ? '#fff' : '#666',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            🔴 リスク順
          </button>
          <button
            onClick={() => setSortBy('size')}
            style={{
              padding: '4px 8px',
              fontSize: '12px',
              border: `1px solid ${sortBy === 'size' ? '#1890ff' : '#d9d9d9'}`,
              backgroundColor: sortBy === 'size' ? '#1890ff' : '#fff',
              color: sortBy === 'size' ? '#fff' : '#666',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            📦 サイズ順
          </button>
          <button
            onClick={() => setSortBy('lines')}
            style={{
              padding: '4px 8px',
              fontSize: '12px',
              border: `1px solid ${sortBy === 'lines' ? '#1890ff' : '#d9d9d9'}`,
              backgroundColor: sortBy === 'lines' ? '#1890ff' : '#fff',
              color: sortBy === 'lines' ? '#fff' : '#666',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            📝 行数順
          </button>
        </div>
      </div>
      <div className="files-grid">
        {getSortedFiles().slice(0, 10).map((file, i) => (
          <div key={i} className="file-card" onClick={() => onSelect(file)} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{file.fileName}</h4>
              <span style={{
                backgroundColor: file.blackboxRisk ? getRiskLevel(file.blackboxRisk.score).color : '#10b981',
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 'bold'
              }}>
                {file.blackboxRisk ? getRiskLevel(file.blackboxRisk.score).icon : '🟢'} {file.blackboxRisk ? getRiskLevel(file.blackboxRisk.score).level : 'LOW'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', fontSize: '0.85rem', color: '#666' }}>
              <span>{file.language}</span>
              <span>{(file.size / 1024).toFixed(1)}KB</span>
              <span>{file.lines}行</span>
            </div>
            {file.technologies.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                {file.technologies.slice(0, 3).map((tech, index) => (
                  <span key={index} style={{
                    backgroundColor: '#f0f0f0',
                    color: '#666',
                    padding: '2px 4px',
                    borderRadius: '3px',
                    fontSize: '0.7rem'
                  }}>
                    {tech}
                  </span>
                ))}
                {file.technologies.length > 3 && (
                  <span style={{ fontSize: '0.7rem', color: '#999' }}>
                    +{file.technologies.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// --- メインAppコンポーネント ---
function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileInZip, setSelectedFileInZip] = useState<FileAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = (file: File) => {
    setSelectedFile(file);
    setError(null);
    setAnalysisResult(null);
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;
    
    setIsAnalyzing(true);
    setError(null);
    
    try {
      // ここに分析ロジックを実装
      // 今はモックデータを使用
      const mockResult: AnalysisResult = {
        type: 'zip',
        totalFiles: 25,
        files: [
          {
            fileName: 'App.tsx',
            language: 'TypeScript',
            size: 10240,
            lines: 320,
            blackboxRisk: { score: 65, level: 'MEDIUM' },
            technologies: ['React', 'TypeScript', 'Hooks']
          },
          {
            fileName: 'index.js',
            language: 'JavaScript',
            size: 5120,
            lines: 180,
            blackboxRisk: { score: 45, level: 'LOW' },
            technologies: ['JavaScript', 'ES6']
          }
        ],
        blackboxRisk: {
          score: 55,
          aiEstimation: { aiLikelihood: 35 }
        },
        summary: {
          totalSize: 256000,
          totalLines: 5000
        }
      };
      
      setAnalysisResult(mockResult);
    } catch (err) {
      setError('分析に失敗しました');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>コード分析ツール</h1>
      </header>

      <main className="App-main">
        <div className="upload-section">
          <div className="drop-zone">
            <div className="drop-zone-content">
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📁</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>
                ファイルをアップロード
              </div>
              <div style={{ fontSize: '14px', color: '#666', marginBottom: '16px' }}>
                ZIPファイルまたは単一ファイルをドラッグ＆ドロップ
              </div>
              <input
                type="file"
                accept=".zip,.js,.ts,.jsx,.tsx,.py,.java"
                onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                style={{ display: 'none' }}
                id="file-input"
              />
              <label
                htmlFor="file-input"
                style={{
                  backgroundColor: '#1890ff',
                  color: 'white',
                  padding: '12px 24px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  transition: 'background-color 0.3s'
                }}
              >
                ファイルを選択
              </label>
              {selectedFile && (
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  style={{
                    backgroundColor: isAnalyzing ? '#ccc' : '#52c41a',
                    color: 'white',
                    padding: '12px 24px',
                    borderRadius: '6px',
                    cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    marginLeft: '8px',
                    transition: 'background-color 0.3s'
                  }}
                >
                  {isAnalyzing ? '分析中...' : '分析開始'}
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            backgroundColor: '#ff4d4f',
            color: 'white',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        {analysisResult && !selectedFileInZip && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
            <BBICard analysis={analysisResult} />
            <FileGrid 
              files={analysisResult.files || []} 
              onSelect={setSelectedFileInZip} 
            />
          </div>
        )}

        {selectedFileInZip && (
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '8px',
            padding: '16px',
            border: '1px solid #e8e8e8'
          }}>
            <button
              onClick={() => setSelectedFileInZip(null)}
              style={{
                backgroundColor: 'none',
                border: 'none',
                color: '#1890ff',
                cursor: 'pointer',
                fontSize: '14px',
                marginBottom: '16px'
              }}
            >
              ← 一覧に戻る
            </button>
            <h2 style={{ margin: '0 0 16px 0' }}>{selectedFileInZip.fileName}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <h4>基本情報</h4>
                <p>言語: {selectedFileInZip.language}</p>
                <p>サイズ: {(selectedFileInZip.size / 1024).toFixed(1)}KB</p>
                <p>行数: {selectedFileInZip.lines}</p>
              </div>
              <div>
                <h4>リスク評価</h4>
                <p>スコア: {selectedFileInZip.blackboxRisk?.score || 0}</p>
                <p>レベル: {selectedFileInZip.blackboxRisk?.level || 'UNKNOWN'}</p>
              </div>
            </div>
            <div style={{ marginTop: '16px' }}>
              <h4>技術スタック</h4>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {selectedFileInZip.technologies.map((tech, index) => (
                  <span key={index} style={{
                    backgroundColor: '#f0f0f0',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}>
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
