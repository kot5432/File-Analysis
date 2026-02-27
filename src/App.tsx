import React, { useState, useEffect } from 'react';
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

interface AnalysisHistory {
  id: string;
  fileName: string;
  analyzedAt: string;
  riskScore: number;
  aiLikelihood: number;
  languages: string[];
  technologies: string[];
  fullResult: AnalysisResult;
}

// --- Utils ---

// 履歴管理ユーティリティ
const HISTORY_KEY = 'analysis_history';
const MAX_HISTORY_ITEMS = 20;

const saveToHistory = (result: AnalysisResult) => {
  try {
    const history: AnalysisHistory[] = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    
    const newHistoryItem: AnalysisHistory = {
      id: Date.now().toString(),
      fileName: result.fileName || result.files?.[0]?.fileName || 'Unknown',
      analyzedAt: new Date().toISOString(),
      riskScore: result.blackboxRisk?.score || 0,
      aiLikelihood: result.blackboxRisk?.aiEstimation?.aiLikelihood || 0,
      languages: result.language ? [result.language] : Object.keys(result.summary?.languages || {}),
      technologies: result.technologies || Object.keys(result.summary?.technologies || {}),
      fullResult: result
    };
    
    history.unshift(newHistoryItem);
    
    // FIFO: 最大件数を超えたら最古を削除
    if (history.length > MAX_HISTORY_ITEMS) {
      history.splice(MAX_HISTORY_ITEMS);
    }
    
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('履歴の保存に失敗しました:', error);
  }
};

const getHistory = (): AnalysisHistory[] => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch (error) {
    console.error('履歴の取得に失敗しました:', error);
    return [];
  }
};

const deleteFromHistory = (id: string) => {
  try {
    const history: AnalysisHistory[] = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const filteredHistory = history.filter(item => item.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filteredHistory));
  } catch (error) {
    console.error('履歴の削除に失敗しました:', error);
  }
};

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
  
  // フレームワーク検出
  if (content.includes('import React') || content.includes('from "react"') || content.includes('React.createElement')) techs.push('React');
  if (content.includes('import Vue') || content.includes('from "vue"') || content.includes('Vue.createApp')) techs.push('Vue.js');
  if (content.includes('import Angular') || content.includes('@angular') || content.includes('@Component')) techs.push('Angular');
  if (content.includes('import Svelte') || content.includes('from "svelte"')) techs.push('Svelte');
  
  // バックエンドフレームワーク
  if (content.includes('express') || content.includes('app.get') || content.includes('app.post')) techs.push('Express.js');
  if (content.includes('fastify') || content.includes('fastify.')) techs.push('Fastify');
  if (content.includes('koa') || content.includes('koa.')) techs.push('Koa.js');
  if (content.includes('nest') || content.includes('@nestjs') || content.includes('@Controller')) techs.push('NestJS');
  if (content.includes('django') || content.includes('from django') || content.includes('models.Model')) techs.push('Django');
  if (content.includes('flask') || content.includes('Flask') || content.includes('app.route')) techs.push('Flask');
  if (content.includes('spring') || content.includes('@SpringBootApplication') || content.includes('@RestController')) techs.push('Spring Boot');
  
  // ライブラリ検出
  if (content.includes('lodash') || content.includes('_.')) techs.push('Lodash');
  if (content.includes('axios') || content.includes('axios.')) techs.push('Axios');
  if (content.includes('fetch(') || content.includes('await fetch')) techs.push('Fetch API');
  if (content.includes('moment') || content.includes('moment()')) techs.push('Moment.js');
  if (content.includes('date-fns') || content.includes('format(')) techs.push('date-fns');
  if (content.includes('chart.js') || content.includes('Chart(')) techs.push('Chart.js');
  if (content.includes('d3') || content.includes('d3.')) techs.push('D3.js');
  if (content.includes('three') || content.includes('THREE.')) techs.push('Three.js');
  
  // スタイリング
  if (content.includes('@emotion') || content.includes('css``')) techs.push('Emotion');
  if (content.includes('styled-components') || content.includes('styled.')) techs.push('Styled Components');
  if (content.includes('tailwind') || content.includes('className=') || content.includes('@tailwind')) techs.push('Tailwind CSS');
  if (content.includes('bootstrap') || content.includes('btn ') || content.includes('container')) techs.push('Bootstrap');
  if (content.includes('material-ui') || content.includes('@mui') || content.includes('<Button')) techs.push('Material-UI');
  
  // 状態管理
  if (content.includes('redux') || content.includes('useSelector') || content.includes('dispatch')) techs.push('Redux');
  if (content.includes('mobx') || content.includes('@observable') || content.includes('action')) techs.push('MobX');
  if (content.includes('zustand') || content.includes('create(')) techs.push('Zustand');
  if (content.includes('recoil') || content.includes('useRecoilState')) techs.push('Recoil');
  
  // 言語ランタイム
  if (content.includes('require(') || content.includes('module.exports') || content.includes('__dirname')) techs.push('Node.js');
  if (content.includes('deno') || content.includes('Deno.')) techs.push('Deno');
  if (content.includes('bun') || content.includes('Bun.')) techs.push('Bun');
  
  // ビルドツール
  if (content.includes('vite') || content.includes('import.meta.hot')) techs.push('Vite');
  if (content.includes('webpack') || content.includes('module.exports')) techs.push('Webpack');
  if (content.includes('rollup') || content.includes('rollup.')) techs.push('Rollup');
  if (content.includes('parcel') || content.includes('Parcel')) techs.push('Parcel');
  
  // テストフレームワーク
  if (content.includes('jest') || content.includes('describe(') || content.includes('it(')) techs.push('Jest');
  if (content.includes('mocha') || content.includes('mocha.')) techs.push('Mocha');
  if (content.includes('cypress') || content.includes('cy.')) techs.push('Cypress');
  if (content.includes('playwright') || content.includes('test(')) techs.push('Playwright');
  
  // データベース
  if (content.includes('mongodb') || content.includes('MongoClient')) techs.push('MongoDB');
  if (content.includes('mysql') || content.includes('mysql2')) techs.push('MySQL');
  if (content.includes('postgresql') || content.includes('pg.')) techs.push('PostgreSQL');
  if (content.includes('sqlite') || content.includes('sqlite3')) techs.push('SQLite');
  if (content.includes('redis') || content.includes('redis.')) techs.push('Redis');
  
  // 言語特有
  if (language.includes('TypeScript')) techs.push('TypeScript');
  if (language.includes('JavaScript')) techs.push('JavaScript');
  if (language.includes('Python')) techs.push('Python');
  if (language.includes('Java')) techs.push('Java');
  if (language.includes('C++')) techs.push('C++');
  if (language.includes('Go')) techs.push('Go');
  if (language.includes('Rust')) techs.push('Rust');
  
  return Array.from(new Set(techs)); // 重複を除去
};

const extractFunctions = (content: string): string[] => {
  const matches = content.match(/function\s+(\w+)|const\s+(\w+)\s*=.*=>|(\w+)\s*:\s*function/g) || [];
  return matches.map(m => m.replace(/function\s+|const\s+|:\s*function|=>.*/g, '').trim());
};

const extractClasses = (content: string): string[] => (content.match(/class\s+(\w+)/g) || []).map(m => m.replace('class ', ''));
const extractImports = (content: string): string[] => (content.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || []).map(m => m.match(/from\s+['"]([^'"]+)['"]/)?.[1] || '');
const extractExports = (content: string): string[] => (content.match(/export\s+(default\s+)?(\w+)/g) || []).map(m => m.replace(/export\s+(default\s+)?/, ''));

// --- 技術スタック詳細分析コンポーネント ---
const TechStackAnalysis: React.FC<{ content: string; language: string }> = ({ content, language }) => {
  const technologies = detectTechnologies(content, language);
  
  const categorizeTechs = () => {
    const categories = {
      'フレームワーク': [] as string[],
      'バックエンド': [] as string[],
      'フロントエンド': [] as string[],
      'ライブラリ': [] as string[],
      'スタイリング': [] as string[],
      '状態管理': [] as string[],
      'ランタイム': [] as string[],
      'ビルドツール': [] as string[],
      'テスト': [] as string[],
      'データベース': [] as string[],
      '言語': [] as string[]
    };
    
    technologies.forEach(tech => {
      if (['React', 'Vue.js', 'Angular', 'Svelte'].includes(tech)) categories['フレームワーク'].push(tech);
      else if (['Express.js', 'Fastify', 'Koa.js', 'NestJS', 'Django', 'Flask', 'Spring Boot'].includes(tech)) categories['バックエンド'].push(tech);
      else if (['React', 'Vue.js', 'Angular', 'Svelte', 'Chart.js', 'D3.js', 'Three.js'].includes(tech)) categories['フロントエンド'].push(tech);
      else if (['Lodash', 'Axios', 'Fetch API', 'Moment.js', 'date-fns'].includes(tech)) categories['ライブラリ'].push(tech);
      else if (['Emotion', 'Styled Components', 'Tailwind CSS', 'Bootstrap', 'Material-UI'].includes(tech)) categories['スタイリング'].push(tech);
      else if (['Redux', 'MobX', 'Zustand', 'Recoil'].includes(tech)) categories['状態管理'].push(tech);
      else if (['Node.js', 'Deno', 'Bun'].includes(tech)) categories['ランタイム'].push(tech);
      else if (['Vite', 'Webpack', 'Rollup', 'Parcel'].includes(tech)) categories['ビルドツール'].push(tech);
      else if (['Jest', 'Mocha', 'Cypress', 'Playwright'].includes(tech)) categories['テスト'].push(tech);
      else if (['MongoDB', 'MySQL', 'PostgreSQL', 'SQLite', 'Redis'].includes(tech)) categories['データベース'].push(tech);
      else if (['TypeScript', 'JavaScript', 'Python', 'Java', 'C++', 'Go', 'Rust'].includes(tech)) categories['言語'].push(tech);
      else {
        // その他の技術を適切に分類
        if (tech.includes('CSS') || tech.includes('HTML')) categories['フロントエンド'].push(tech);
        else categories['ライブラリ'].push(tech);
      }
    });
    
    return categories;
  };
  
  const categories = categorizeTechs();
  
  const getTechDescription = (tech: string): string => {
    const descriptions: { [key: string]: string } = {
      'React': 'コンポーネントベースのUIライブラリ。仮想DOMによる高速なレンダリング。',
      'Vue.js': 'プログレッシブなJavaScriptフレームワーク。学習コストが低く、柔軟性が高い。',
      'Angular': 'Google開発の完全なフレームワーク。エンタープライズ向けに強い。',
      'Express.js': 'Node.jsの高速・ミニマルなWebフレームワーク。',
      'Django': 'Pythonの「バッテリー同梱」Webフレームワーク。',
      'Flask': 'Pythonの軽量マイクロフレームワーク。',
      'Node.js': 'サーバーサイドJavaScript実行環境。',
      'TypeScript': 'JavaScriptに静的型付けを追加した言語。',
      'Redux': '予測可能な状態コンテナ。',
      'Tailwind CSS': 'ユーティリティファーストのCSSフレームワーク。',
      'MongoDB': 'ドキュメント指向のNoSQLデータベース。',
      'MySQL': '世界で最も人気のあるリレーショナルデータベース。',
      'Vite': '次世代の高速ビルドツール。',
      'Webpack': 'JavaScriptモジュールバンドラー。',
      'Jest': 'JavaScriptテストフレームワーク。'
    };
    return descriptions[tech] || `${tech}技術が使用されています。`;
  };
  
  const analyzeArchitecture = () => {
    const isSPA = ['React', 'Vue.js', 'Angular', 'Svelte'].some(tech => technologies.includes(tech));
    const isSSR = content.includes('getServerSideProps') || content.includes('getStaticProps') || content.includes('server');
    const isAPI = content.includes('app.get') || content.includes('app.post') || content.includes('router');
    const isMicroservice = content.includes('microservice') || content.includes('service') || content.includes('controller');
    
    return {
      architecture: isSPA ? 'SPA (Single Page Application)' : isSSR ? 'SSR (Server Side Rendering)' : 'Multi Page Application',
      backend: isAPI ? 'REST API' : isMicroservice ? 'Microservices' : 'Monolithic',
      frontend: isSPA ? 'Component-based' : 'Traditional',
      dataFlow: categories['状態管理'].length > 0 ? 'State Management' : 'Props/Events'
    };
  };
  
  const architecture = analyzeArchitecture();
  
  if (technologies.length === 0) {
    return (
      <div className="tech-stack-analysis" style={{ 
        backgroundColor: '#f5f5f5', 
        padding: '16px', 
        borderRadius: '8px', 
        marginTop: '16px' 
      }}>
        <h3>技術スタック分析</h3>
        <p>技術が検出されませんでした。</p>
      </div>
    );
  }
  
  return (
    <div className="tech-stack-analysis" style={{ 
      backgroundColor: '#f5f5f5', 
      padding: '16px', 
      borderRadius: '8px', 
      marginTop: '16px' 
    }}>
      <h3>🔧 技術スタック分析</h3>
      
      {/* アーキテクチャ概要 */}
      <div style={{ marginBottom: '20px' }}>
        <h4>📐 アーキテクチャ</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px' }}>
            <strong>種類:</strong> {architecture.architecture}
          </div>
          <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px' }}>
            <strong>バックエンド:</strong> {architecture.backend}
          </div>
          <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px' }}>
            <strong>フロントエンド:</strong> {architecture.frontend}
          </div>
          <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px' }}>
            <strong>データフロー:</strong> {architecture.dataFlow}
          </div>
        </div>
      </div>
      
      {/* 技術カテゴリ */}
      <div style={{ marginBottom: '20px' }}>
        <h4>🛠️ 技術カテゴリ</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px' }}>
          {Object.entries(categories).map(([category, techs]) => (
            techs.length > 0 && (
              <div key={category} style={{ 
                backgroundColor: 'white', 
                padding: '12px', 
                borderRadius: '4px',
                border: '1px solid #e0e0e0'
              }}>
                <h5 style={{ margin: '0 0 8px 0', color: '#1890ff' }}>{category}</h5>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {techs.map(tech => (
                    <span 
                      key={tech}
                      style={{ 
                        backgroundColor: '#f0f0f0', 
                        padding: '4px 8px', 
                        borderRadius: '12px', 
                        fontSize: '12px',
                        border: '1px solid #d0d0d0'
                      }}
                      >
                        {tech}
                      </span>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      </div>
      
      {/* 技術詳細 */}
      <div>
        <h4>📖 技術詳細</h4>
        <div style={{ display: 'grid', gap: '12px' }}>
          {technologies.map(tech => (
            <div key={tech} style={{ 
              backgroundColor: 'white', 
              padding: '12px', 
              borderRadius: '4px',
              border: '1px solid #e0e0e0'
            }}>
              <h6 style={{ margin: '0 0 8px 0', color: '#1890ff' }}>{tech}</h6>
              <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.4' }}>
                {getTechDescription(tech)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

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
  const [copied, setCopied] = React.useState(false);
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

  const generateReport = () => {
    let report = "【コード分析ツール - 詳細リスク判定レポート】\n";
    report += `分析日時: ${new Date().toLocaleString()}\n`;
    report += `該当ハイリスク件数: ${highRiskFiles.length}件\n`;
    report += "--------------------------------------------------\n\n";

    highRiskFiles.forEach((f, i) => {
      report += `${i + 1}. ファイル名: ${f.fileName}\n`;
      report += `   総合リスクスコア: ${f.blackboxRisk?.score} / 100\n`;
      report += `   判定: ${f.blackboxRisk?.level}\n\n`;

      report += "   [詳細分析結果]\n";
      const risk = f.blackboxRisk;
      if (!risk) {
        report += "   - リスクデータが取得できませんでした。\n";
      } else {
        // Nested Logic Detail
        if (risk.nestingDepth) {
          const depth = risk.nestingDepth.maxDepth;
          report += `   ● 制御構造の複雑さ (最大ネスト数: ${depth})\n`;
          if (depth > 5) {
            report += `     ⇒ 最大ネスト数が${depth}に達しています。一般的に5階層を超えるとロジックの追跡が困難になり、バグの温床となります。関数の分割を検討してください。\n`;
          } else {
            report += `     ⇒ ネスト数は${depth}で許容範囲内ですが、他の要因と組み合わさりリスクとなっています。\n`;
          }
        }

        // File Size Detail
        if (risk.fileSize) {
          const lines = risk.fileSize.lineCount;
          report += `   ● ファイル規模 (行数: ${lines}行)\n`;
          if (lines > 500) {
            report += `     ⇒ 1ファイルあたりの推奨行数(500行)を大幅に超えています。単一責任原則（SRP）に基づき、コンポーネントやロジックの分離を推奨します。\n`;
          }
        }

        // Comment/Documentation Detail
        if (risk.commentRatio) {
          const ratio = Math.round(risk.commentRatio.commentRatio * 100);
          report += `   ● ドキュメント密度 (コメント率: ${ratio}%)\n`;
          if (ratio < 10) {
            report += `     ⇒ 複雑なロジックに対してコメントが非常に少ないです。意図の不明なコードはメンテナンスコストを増大させます。\n`;
          }
        }

        // Unused Functions Detail
        if (risk.unusedFunctions && risk.unusedFunctions.count > 0) {
          report += `   ● メンテナンス性 (未使用コード: ${risk.unusedFunctions.count}件)\n`;
          report += `     ⇒ 使用されていない関数や変数が検出されました。死んだコードの蓄積はリファクタリングを阻害します。\n`;
        }

        // AI Estimation Detail
        if (risk.aiEstimation) {
          const ai = risk.aiEstimation.aiLikelihood;
          report += `   ● コードの出自 (AI生成の可能性: ${ai}%)\n`;
          if (ai > 70) {
            report += `     ⇒ AIによって生成された可能性が非常に高いです。特有のパターンが見られます。人間による詳細な論理検証が必須です。\n`;
          }
        }
      }

      report += "\n   [改善へのアドバイス]\n";
      report += "   - コードをより小さな、テスト可能な単位に分割してください。\n";
      report += "   - 複雑な分岐やループがある箇所に、その意図を説明するコメントを追加してください。\n";
      report += "--------------------------------------------------\n\n";
    });

    report += "以上、分析レポートを終了します。";
    return report;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generateReport());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="high-risk-summary" style={{ backgroundColor: '#fff1f0', border: '1px solid #ffa39e', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ color: '#cf1322', margin: 0 }}>🚨 ハイリスク・ファイル検知 ({highRiskFiles.length}件)</h3>
        <button
          onClick={handleCopy}
          style={{
            backgroundColor: copied ? '#52c41a' : '#cf1322',
            color: '#fff',
            border: 'none',
            padding: '6px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.85rem',
            transition: 'background-color 0.3s'
          }}
        >
          {copied ? 'コピーしました！' : 'レポートをコピー'}
        </button>
      </div>
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
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AnalysisHistory[]>([]);
  const [fileContent, setFileContent] = useState<string>('');

  const SUPPORTED_EXTENSIONS = [
    '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.xml', '.php', '.py', '.java',
    '.cpp', '.c', '.h', '.cs', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.r', '.m',
    '.sh', '.sql', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.md', '.txt',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.tgz'
  ];

  const isSupportedFile = (name: string) => SUPPORTED_EXTENSIONS.includes('.' + name.split('.').pop()?.toLowerCase());

  // 履歴読み込み
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  // 履歴保存
  useEffect(() => {
    if (analysisResult) {
      saveToHistory(analysisResult);
      setHistory(getHistory());
    }
  }, [analysisResult]);

  // 履歴削除
  const handleDeleteHistory = (id: string) => {
    if (window.confirm('この履歴を削除してもよろしいですか？')) {
      deleteFromHistory(id);
      setHistory(getHistory());
    }
  };

  // 履歴詳細表示
  const handleShowHistoryDetail = (historyItem: AnalysisHistory) => {
    setAnalysisResult(historyItem.fullResult);
    setShowHistory(false);
  };

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
        setFileContent(content);
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
        <button 
          onClick={() => setShowHistory(!showHistory)} 
          className="history-button"
          style={{ 
            position: 'absolute', 
            right: '20px', 
            top: '20px',
            padding: '8px 16px',
            backgroundColor: '#1890ff',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          履歴 ({history.length})
        </button>
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

              {/* 技術スタック詳細分析 */}
              {analysisResult.type === 'single' && fileContent && (
                <TechStackAnalysis 
                  content={fileContent} 
                  language={analysisResult.language || ''} 
                />
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

              {/* ZIPファイル全体の技術スタック分析 */}
              {analysisResult.type === 'zip' && analysisResult.files && (
                <div className="zip-tech-analysis" style={{ 
                  backgroundColor: '#f5f5f5', 
                  padding: '16px', 
                  borderRadius: '8px', 
                  marginTop: '16px' 
                }}>
                  <h3>🔧 プロジェクト全体の技術スタック</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px' }}>
                    {(() => {
                      const allTechnologies = new Set<string>();
                      const allLanguages = new Set<string>();
                      
                      analysisResult.files.forEach(file => {
                        if (file.technologies) {
                          file.technologies.forEach(tech => allTechnologies.add(tech));
                        }
                        allLanguages.add(file.language);
                      });
                      
                      const techArray = Array.from(allTechnologies);
                      const langArray = Array.from(allLanguages);
                      
                      return (
                        <>
                          <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
                            <h5 style={{ margin: '0 0 8px 0', color: '#1890ff' }}>📋 言語</h5>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {langArray.map(lang => (
                                <span 
                                  key={lang}
                                  style={{ 
                                    backgroundColor: '#f0f0f0', 
                                    padding: '4px 8px', 
                                    borderRadius: '12px', 
                                    fontSize: '12px',
                                    border: '1px solid #d0d0d0'
                                  }}
                                >
                                  {lang}
                                </span>
                              ))}
                            </div>
                          </div>
                          
                          <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
                            <h5 style={{ margin: '0 0 8px 0', color: '#1890ff' }}>🛠️ 技術</h5>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {techArray.map(tech => (
                                <span 
                                  key={tech}
                                  style={{ 
                                    backgroundColor: '#e6f7ff', 
                                    padding: '4px 8px', 
                                    borderRadius: '12px', 
                                    fontSize: '12px',
                                    border: '1px solid #d0d0d0'
                                  }}
                                >
                                  {tech}
                                </span>
                              ))}
                            </div>
                          </div>
                          
                          <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
                            <h5 style={{ margin: '0 0 8px 0', color: '#1890ff' }}>📊 プロジェクト概要</h5>
                            <div style={{ fontSize: '14px' }}>
                              <p><strong>ファイル数:</strong> {analysisResult.totalFiles}件</p>
                              <p><strong>主要言語:</strong> {langArray.slice(0, 3).join(', ')}{langArray.length > 3 ? `... 他${langArray.length - 3}件` : ''}</p>
                              <p><strong>主要技術:</strong> {techArray.slice(0, 5).join(', ')}{techArray.length > 5 ? `... 他${techArray.length - 5}件` : ''}</p>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* 履歴一覧 */}
        {showHistory && (
          <div className="history-overlay" style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            backgroundColor: 'rgba(0,0,0,0.5)', 
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div className="history-content" style={{ 
              backgroundColor: 'white', 
              borderRadius: '8px', 
              padding: '24px', 
              maxWidth: '800px', 
              maxHeight: '80vh', 
              overflow: 'auto',
              width: '90%'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2>解析履歴</h2>
                <button 
                  onClick={() => setShowHistory(false)}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    fontSize: '24px', 
                    cursor: 'pointer' 
                  }}
                >
                  ×
                </button>
              </div>
              
              {history.length === 0 ? (
                <p>履歴がありません</p>
              ) : (
                <div className="history-grid" style={{ display: 'grid', gap: '16px' }}>
                  {history.map((item) => (
                    <div 
                      key={item.id}
                      className="history-card"
                      style={{ 
                        border: '1px solid #d9d9d9', 
                        borderRadius: '8px', 
                        padding: '16px',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onClick={() => handleShowHistoryDetail(item)}
                      onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
                      onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                        <div>
                          <h4 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>{item.fileName}</h4>
                          <p style={{ margin: 0, color: '#666', fontSize: '12px' }}>
                            {new Date(item.analyzedAt).toLocaleString('ja-JP')}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteHistory(item.id);
                          }}
                          style={{
                            background: '#ff4d4f',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          削除
                        </button>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <span 
                          className="risk-badge"
                          style={{ 
                            backgroundColor: item.riskScore >= 70 ? '#ff4d4f' : item.riskScore >= 40 ? '#faad14' : '#52c41a',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: 'bold'
                          }}
                        >
                          リスク: {item.riskScore}
                        </span>
                        <span 
                          className="ai-badge"
                          style={{ 
                            backgroundColor: item.aiLikelihood >= 70 ? '#ff4d4f' : item.aiLikelihood >= 40 ? '#faad14' : '#52c41a',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: 'bold'
                          }}
                        >
                          AI: {item.aiLikelihood}%
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {item.languages.slice(0, 3).map(lang => (
                          <span 
                            key={lang}
                            className="lang-tag"
                            style={{ 
                              backgroundColor: '#f0f0f0', 
                              padding: '2px 6px', 
                              borderRadius: '4px', 
                              fontSize: '10px' 
                            }}
                          >
                            {lang}
                          </span>
                        ))}
                        {item.technologies.slice(0, 3).map(tech => (
                          <span 
                            key={tech}
                            className="tech-tag"
                            style={{ 
                              backgroundColor: '#e6f7ff', 
                              padding: '2px 6px', 
                              borderRadius: '4px', 
                              fontSize: '10px' 
                            }}
                          >
                            {tech}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
