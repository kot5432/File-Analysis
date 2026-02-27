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

// --- プロジェクトタイプ自動判定ロジック ---
const detectProjectType = (result: AnalysisResult, content?: string): {
  type: string;
  confidence: number;
  reasons: string[];
} => {
  const technologies = result.type === 'zip' 
    ? Object.keys(result.summary?.technologies || {})
    : result.technologies || [];
  
  const languages = result.type === 'zip'
    ? Object.keys(result.summary?.languages || {})
    : [result.language].filter(Boolean);
  
  const reasons: string[] = [];
  let confidence = 0;
  let projectType = 'General Software Project';

  // Step A: フルスタック判定（最優先）
  const frontendFrameworks = ['React', 'Vue.js', 'Angular', 'Svelte', 'Next.js', 'Nuxt.js'];
  const backendFrameworks = ['Express.js', 'Fastify', 'Koa.js', 'NestJS', 'Django', 'Flask', 'Spring Boot'];
  
  const hasFrontend = frontendFrameworks.some(fw => technologies.includes(fw));
  const hasBackend = backendFrameworks.some(fw => technologies.includes(fw));
  
  if (hasFrontend && hasBackend) {
    projectType = 'Fullstack Web App';
    confidence = 0.9;
    
    if (technologies.includes('React')) {
      reasons.push('React detected');
    }
    if (technologies.includes('Vue.js')) {
      reasons.push('Vue.js detected');
    }
    if (technologies.includes('Express.js')) {
      reasons.push('Express.js backend');
    }
    if (technologies.includes('Node.js')) {
      reasons.push('Node.js runtime');
    }
    
    return { type: projectType, confidence, reasons };
  }

  // Step B: フロントエンド判定
  if (hasFrontend) {
    if (technologies.includes('React')) {
      // React系の詳細判定
      if (technologies.includes('Next.js')) {
        projectType = 'Next.js App';
        confidence = 0.85;
        reasons.push('Next.js framework detected');
      } else if (content && (content.includes('ReactDOM.render') || content.includes('createRoot'))) {
        projectType = 'React SPA';
        confidence = 0.9;
        reasons.push('React detected');
        reasons.push('ReactDOM entry point');
        if (content.includes('getServerSideProps') || content.includes('getStaticProps')) {
          projectType = 'React SSR App';
          reasons.push('SSR features detected');
        }
      } else {
        projectType = 'React App';
        confidence = 0.75;
        reasons.push('React detected');
      }
    } else if (technologies.includes('Vue.js')) {
      if (technologies.includes('Nuxt.js')) {
        projectType = 'Nuxt.js App';
        confidence = 0.85;
        reasons.push('Nuxt.js framework detected');
      } else if (content && (content.includes('Vue.createApp') || content.includes('createApp'))) {
        projectType = 'Vue.js SPA';
        confidence = 0.9;
        reasons.push('Vue.js detected');
        reasons.push('Vue.createApp entry point');
      } else {
        projectType = 'Vue.js App';
        confidence = 0.75;
        reasons.push('Vue.js detected');
      }
    } else if (technologies.includes('Angular')) {
      projectType = 'Angular App';
      confidence = 0.85;
      reasons.push('Angular framework detected');
    } else if (technologies.includes('Svelte')) {
      if (technologies.includes('SvelteKit')) {
        projectType = 'SvelteKit App';
        confidence = 0.85;
        reasons.push('SvelteKit framework detected');
      } else {
        projectType = 'Svelte App';
        confidence = 0.75;
        reasons.push('Svelte detected');
      }
    }
    
    return { type: projectType, confidence, reasons };
  }

  // Step C: バックエンド判定
  if (hasBackend) {
    if (technologies.includes('Express.js') || technologies.includes('Node.js')) {
      projectType = 'Node.js API';
      confidence = 0.85;
      reasons.push('Express.js/Node.js detected');
      
      if (content && (content.includes('app.listen') || content.includes('app.get') || content.includes('app.post'))) {
        reasons.push('Express server patterns');
      }
    } else if (technologies.includes('Django')) {
      projectType = 'Django Web App';
      confidence = 0.9;
      reasons.push('Django framework detected');
    } else if (technologies.includes('Flask')) {
      projectType = 'Flask Web App';
      confidence = 0.85;
      reasons.push('Flask framework detected');
    } else if (technologies.includes('Spring Boot')) {
      projectType = 'Spring Boot App';
      confidence = 0.9;
      reasons.push('Spring Boot framework detected');
    } else if (technologies.includes('Fastify')) {
      projectType = 'Fastify API';
      confidence = 0.8;
      reasons.push('Fastify framework detected');
    }
    
    return { type: projectType, confidence, reasons };
  }

  // Step D: スクリプト判定
  if (languages.length === 1 && !hasFrontend && !hasBackend) {
    const language = languages[0];
    
    if (language === 'Python') {
      if (content && content.includes('if __name__ == "__main__"')) {
        projectType = 'Python Script';
        confidence = 0.8;
        reasons.push('Python main script pattern');
      } else {
        projectType = 'Python Module';
        confidence = 0.7;
        reasons.push('Python single language');
      }
    } else if (language === 'JavaScript') {
      if (content && (content.includes('node ') || content.includes('#!/usr/bin/env node'))) {
        projectType = 'Node.js Script';
        confidence = 0.8;
        reasons.push('Node.js script pattern');
      } else {
        projectType = 'JavaScript Module';
        confidence = 0.7;
        reasons.push('JavaScript single language');
      }
    } else if (language === 'Java') {
      if (content && content.includes('public static void main')) {
        projectType = 'Java Application';
        confidence = 0.85;
        reasons.push('Java main method');
      } else {
        projectType = 'Java Module';
        confidence = 0.7;
        reasons.push('Java single language');
      }
    } else if (language === 'Go') {
      if (content && content.includes('func main()')) {
        projectType = 'Go Application';
        confidence = 0.85;
        reasons.push('Go main function');
      } else {
        projectType = 'Go Module';
        confidence = 0.7;
        reasons.push('Go single language');
      }
    } else if (language === 'Rust') {
      if (content && content.includes('fn main()')) {
        projectType = 'Rust Application';
        confidence = 0.85;
        reasons.push('Rust main function');
      } else {
        projectType = 'Rust Module';
        confidence = 0.7;
        reasons.push('Rust single language');
      }
    }
    
    return { type: projectType, confidence, reasons };
  }

  // Step E: 特殊ケース判定
  if (technologies.includes('HTML') && technologies.includes('CSS') && technologies.includes('JavaScript')) {
    if (!hasFrontend && !hasBackend) {
      projectType = 'Static Website';
      confidence = 0.8;
      reasons.push('HTML/CSS/JS stack without frameworks');
    }
  }

  if (technologies.includes('TypeScript') && languages.includes('TypeScript')) {
    if (!hasFrontend && !hasBackend) {
      projectType = 'TypeScript Project';
      confidence = 0.75;
      reasons.push('TypeScript single language');
    }
  }

  // Step F: フォールバック
  if (projectType === 'General Software Project') {
    confidence = 0.5;
    
    if (result.type === 'zip' && result.totalFiles && result.totalFiles > 1) {
      projectType = 'Multi-language Project';
      reasons.push('Multiple files detected');
    } else {
      projectType = 'Single File';
      reasons.push('Single file project');
    }
  }

  return { type: projectType, confidence, reasons };
};
// --- プロジェクト要約ビューコンポーネント ---
const ProjectSummaryView: React.FC<{ result: AnalysisResult; fileName: string; content?: string }> = ({ result, fileName, content }) => {
  // 自動判定ロジックを使用
  const projectTypeDetection = detectProjectType(result, content);
  const detectedProjectType = projectTypeDetection.type;
  const confidence = projectTypeDetection.confidence;
  const reasons = projectTypeDetection.reasons;

  const getRiskLevel = () => {
    const riskScore = result.blackboxRisk?.score || 0;
    if (riskScore >= 70) return { level: 'HIGH', color: '#ff4d4f', bgColor: '#fff2f0', borderColor: '#ffccc7' };
    if (riskScore >= 40) return { level: 'MEDIUM', color: '#faad14', bgColor: '#fffbe6', borderColor: '#ffe58f' };
    return { level: 'LOW', color: '#52c41a', bgColor: '#f6ffed', borderColor: '#b7eb8f' };
  };

  const getAILevel = () => {
    const aiLikelihood = result.blackboxRisk?.aiEstimation?.aiLikelihood || 0;
    if (aiLikelihood >= 70) return { level: 'HIGH', color: '#ff4d4f', bgColor: '#fff2f0', borderColor: '#ffccc7' };
    if (aiLikelihood >= 40) return { level: 'MEDIUM', color: '#faad14', bgColor: '#fffbe6', borderColor: '#ffe58f' };
    return { level: 'LOW', color: '#52c41a', bgColor: '#f6ffed', borderColor: '#b7eb8f' };
  };

  const getMainTechnologies = () => {
    if (result.type === 'zip') {
      return Object.entries(result.summary?.technologies || {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([tech]) => tech);
    }
    return result.technologies?.slice(0, 5) || [];
  };

  const getProjectScale = () => {
    if (result.type === 'zip') {
      const files = result.totalFiles || 0;
      const lines = result.summary?.totalLines || 0;
      const maxFile = Math.max(...(result.files?.map(f => f.lines) || [0]));
      
      return {
        totalFiles: files,
        totalLines: lines,
        maxFile: maxFile
      };
    }
    
    return {
      totalFiles: 1,
      totalLines: result.lines || 0,
      maxFile: result.lines || 0
    };
  };

  const projectType = detectedProjectType;
  const riskLevel = getRiskLevel();
  const aiLevel = getAILevel();
  const mainTechs = getMainTechnologies();
  const scale = getProjectScale();
  const riskScore = result.blackboxRisk?.score || 0;
  const aiScore = result.blackboxRisk?.aiEstimation?.aiLikelihood || 0;

  return (
    <div className="project-snapshot" style={{
      backgroundColor: '#fafafa',
      border: '1px solid #d9d9d9',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '24px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
    }}>
      {/* ヘッダー */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '20px',
        paddingBottom: '16px',
        borderBottom: '1px solid #e8e8e8'
      }}>
        <div>
          <h2 style={{ 
            margin: 0, 
            fontSize: '20px', 
            fontWeight: '600',
            color: '#262626'
          }}>
            📁 {fileName}
          </h2>
          <p style={{ 
            margin: '4px 0 0 0', 
            fontSize: '16px',
            color: '#595959',
            fontWeight: '500'
          }}>
            {projectType}
            <span style={{ 
              marginLeft: '8px',
              fontSize: '12px',
              color: '#8c8c8c',
              backgroundColor: '#f0f0f0',
              padding: '2px 6px',
              borderRadius: '4px'
            }}>
              {Math.round(confidence * 100)}%確信
            </span>
          </p>
        </div>
        
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', color: '#8c8c8c', marginBottom: '2px' }}>
            解析完了
          </div>
          <div style={{ fontSize: '11px', color: '#bfbfbf' }}>
            {new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '20px' }}>
        
        {/* 左側：総合評価 */}
        <div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            総合評価
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* ブラックボックスリスク */}
            <div style={{
              backgroundColor: riskLevel.bgColor,
              border: `1px solid ${riskLevel.borderColor}`,
              borderRadius: '8px',
              padding: '12px'
            }}>
              <div style={{ fontSize: '12px', color: '#595959', marginBottom: '4px' }}>
                ブラックボックスリスク
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <span style={{ 
                  fontSize: '24px', 
                  fontWeight: 'bold', 
                  color: riskLevel.color 
                }}>
                  {riskScore}
                </span>
                <span style={{ 
                  fontSize: '14px', 
                  fontWeight: '600', 
                  backgroundColor: riskLevel.color,
                  color: 'white',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}>
                  {riskLevel.level}
                </span>
              </div>
            </div>

            {/* AI生成確率 */}
            <div style={{
              backgroundColor: aiLevel.bgColor,
              border: `1px solid ${aiLevel.borderColor}`,
              borderRadius: '8px',
              padding: '12px'
            }}>
              <div style={{ fontSize: '12px', color: '#595959', marginBottom: '4px' }}>
                🤖 AI生成確率
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <span style={{ 
                  fontSize: '24px', 
                  fontWeight: 'bold', 
                  color: aiLevel.color 
                }}>
                  {aiScore}%
                </span>
                <span style={{ 
                  fontSize: '14px', 
                  fontWeight: '600', 
                  backgroundColor: aiLevel.color,
                  color: 'white',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}>
                  {aiLevel.level}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: '#8c8c8c', marginTop: '4px' }}>
                ※ This is heuristic estimation, not definitive AI detection.
              </div>
            </div>
          </div>
        </div>

        {/* 右側：技術・規模 */}
        <div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            技術・規模
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* 主技術スタック */}
            <div style={{
              backgroundColor: 'white',
              border: '1px solid #e8e8e8',
              borderRadius: '8px',
              padding: '12px'
            }}>
              <div style={{ fontSize: '12px', color: '#595959', marginBottom: '8px' }}>
                🛠️ 主技術スタック
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {mainTechs.slice(0, 5).map((tech, index) => (
                  <span 
                    key={tech}
                    style={{
                      backgroundColor: '#f0f0f0',
                      color: '#262626',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500'
                    }}
                  >
                    {tech}
                  </span>
                ))}
                {mainTechs.length > 5 && (
                  <span style={{ fontSize: '12px', color: '#8c8c8c' }}>
                    +{mainTechs.length - 5}
                  </span>
                )}
              </div>
            </div>

            {/* プロジェクト規模 */}
            <div style={{
              backgroundColor: 'white',
              border: '1px solid #e8e8e8',
              borderRadius: '8px',
              padding: '12px'
            }}>
              <div style={{ fontSize: '12px', color: '#595959', marginBottom: '8px' }}>
                📊 プロジェクト規模
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#262626' }}>
                    {scale.totalFiles}
                  </div>
                  <div style={{ fontSize: '10px', color: '#8c8c8c' }}>
                    ファイル
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#262626' }}>
                    {scale.totalLines.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '10px', color: '#8c8c8c' }}>
                    総行数
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#262626' }}>
                    {scale.maxFile.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '10px', color: '#8c8c8c' }}>
                    最大ファイル
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 補足説明 */}
      <div style={{
        backgroundColor: '#f0f7ff',
        border: '1px solid #d6e4ff',
        borderRadius: '8px',
        padding: '12px 16px',
        fontSize: '14px',
        color: '#0958d9',
        lineHeight: '1.4'
      }}>
        <strong>💡 プロジェクト概要:</strong> {projectType}で、{mainTechs.slice(0, 3).join('・')}を使用した{scale.totalFiles}ファイルのプロジェクトです。
        {riskLevel.level === 'HIGH' && ' リスクが高いため注意が必要です。'}
        {aiLevel.level === 'HIGH' && ' AI生成コードが含まれている可能性があります。'}
        {reasons.length > 0 && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
            <strong>判定理由:</strong> {reasons.join('・')}
          </div>
        )}
      </div>
    </div>
  );
};
// --- 読む順番ガイドコンポーネント ---
const ReadingOrderGuide: React.FC<{ files?: FileAnalysis[]; singleFile?: AnalysisResult }> = ({ files, singleFile }) => {
  const calculateImportanceScore = (file: FileAnalysis): number => {
    let score = 0;
    
    // 🥇 ① エントリーポイントボーナス（最重要）
    const fileName = file.fileName.toLowerCase();
    
    if (fileName.includes('index') || fileName.includes('main') || fileName.includes('app')) {
      score += 50; // 最大ボーナス
    }
    
    // 🥈 ② import集中度（大）
    // 他ファイルからどれだけ参照されているかを推定
    // 実際にはクロスファイル解析が必要だが、ここではエクスポート数で代替
    score += Math.min(file.structure.exports.length * 10, 30);
    
    // 🥉 ③ ファイルサイズ（中）
    // 大きすぎはノイズになるので上限を設定
    score += Math.min(file.lines / 50, 20);
    
    // ④ 技術シグナル（中）
    // ファイル名や構造から技術的中核を推定
    if (fileName.includes('router') || fileName.includes('routes')) {
      score += 15;
    }
    if (fileName.includes('controller') || fileName.includes('controllers')) {
      score += 15;
    }
    if (fileName.includes('service') || fileName.includes('services')) {
      score += 10;
    }
    if (fileName.includes('config') || fileName.includes('configuration')) {
      score += 10;
    }
    
    // ⑤ ブラックボックスリスク（補助）
    // 危険ファイルを早期に発見
    if (file.blackboxRisk && file.blackboxRisk.score > 60) {
      score += 5;
    }
    
    return score;
  };

  const getReasonTags = (file: FileAnalysis, score: number): string[] => {
    const tags: string[] = [];
    const fileName = file.fileName.toLowerCase();
    
    // エントリーポイント判定
    if (fileName.includes('index') || fileName.includes('main') || fileName.includes('app')) {
      tags.push('🏷 Entry Point');
    }
    
    // import集中度判定
    if (file.structure.exports.length > 5) {
      tags.push('🏷 Highly Exported');
    }
    
    // ファイルサイズ判定
    if (file.lines > 500) {
      tags.push('🏷 Large File');
    }
    
    // 技術的中核判定
    if (fileName.includes('router') || fileName.includes('routes')) {
      tags.push('🏷 Router Core');
    }
    if (fileName.includes('controller') || fileName.includes('controllers')) {
      tags.push('🏷 Controller');
    }
    if (fileName.includes('service') || fileName.includes('services')) {
      tags.push('🏷 Service Layer');
    }
    if (fileName.includes('config') || fileName.includes('configuration')) {
      tags.push('🏷 Configuration');
    }
    
    // リスク判定
    if (file.blackboxRisk && file.blackboxRisk.score > 60) {
      tags.push('🏷 High Risk');
    }
    
    // デフォルトタグ
    if (tags.length === 0) {
      tags.push('🏷 Standard File');
    }
    
    return tags;
  };

  const getReadingOrder = () => {
    if (singleFile) {
      return [{
        file: {
          fileName: singleFile.fileName || '',
          language: singleFile.language || '',
          technologies: singleFile.technologies || [],
          size: singleFile.size || 0,
          lines: singleFile.lines || 0,
          structure: singleFile.structure || { functions: [], classes: [], imports: [], exports: [] },
          blackboxRisk: singleFile.blackboxRisk
        },
        score: 100,
        reasons: ['🏷 Only File']
      }];
    }
    
    if (!files) return [];
    
    const scoredFiles = files.map(file => ({
      file,
      score: calculateImportanceScore(file),
      reasons: getReasonTags(file, calculateImportanceScore(file))
    }));
    
    return scoredFiles.sort((a, b) => b.score - a.score).slice(0, 5);
  };

  const readingOrder = getReadingOrder();

  if (readingOrder.length === 0) return null;

  return (
    <div className="reading-order-guide" style={{
      backgroundColor: '#f8f9fa',
      padding: '24px',
      borderRadius: '12px',
      marginBottom: '24px',
      border: '2px solid #e3f2fd'
    }}>
      <h3 style={{ margin: '0 0 16px 0', color: '#1976d2', fontSize: '20px', fontWeight: '600' }}>
        🧭 Recommended Reading Order
      </h3>
      
      <div style={{ marginBottom: '20px', fontSize: '14px', color: '#666', lineHeight: '1.4' }}>
        💡 この順番で読むと、プロジェクトの理解が最も速くなります。各ファイルの重要度と理由を示しています。
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {readingOrder.map((item, index) => (
          <div 
            key={item.file.fileName}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '16px',
              backgroundColor: 'white',
              borderRadius: '8px',
              border: '1px solid #e0e0e0',
              transition: 'all 0.2s',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {/* 順位番号 */}
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: index === 0 ? '#4caf50' : index === 1 ? '#ff9800' : index === 2 ? '#2196f3' : '#9e9e9e',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              fontSize: '16px',
              flexShrink: 0
            }}>
              {index + 1}
            </div>
            
            {/* ファイル情報 */}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '4px', color: '#262626' }}>
                📄 {item.file.fileName}
              </div>
              <div style={{ fontSize: '14px', color: '#666', marginBottom: '6px' }}>
                {item.file.language} • {item.file.lines.toLocaleString()}行 • {item.file.technologies.slice(0, 3).join(', ')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {item.reasons.map((reason, reasonIndex) => (
                  <span 
                    key={reasonIndex}
                    style={{
                      backgroundColor: '#f0f0f0',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      color: '#595959',
                      border: '1px solid #d0d0d0'
                    }}
                  >
                    {reason}
                  </span>
                ))}
              </div>
            </div>
            
            {/* 重要度スコア */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>重要度</div>
              <div style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: item.score > 70 ? '#4caf50' : item.score > 40 ? '#ff9800' : '#9e9e9e'
              }}>
                {Math.round(item.score)}
              </div>
              <div style={{
                width: '60px',
                height: '4px',
                backgroundColor: '#e0e0e0',
                borderRadius: '2px',
                marginTop: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${Math.min(item.score, 100)}%`,
                  height: '100%',
                  backgroundColor: item.score > 70 ? '#4caf50' : item.score > 40 ? '#ff9800' : '#9e9e9e',
                  borderRadius: '2px'
                }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* 読解のヒント */}
      <div style={{
        marginTop: '20px',
        padding: '16px',
        backgroundColor: '#e3f2fd',
        borderRadius: '8px',
        fontSize: '14px',
        color: '#1976d2',
        lineHeight: '1.4'
      }}>
        <strong>💡 読解のヒント:</strong> 
        {readingOrder[0].reasons.some(r => r.includes('Entry Point')) 
          ? ' まずエントリーポイントから読むことで、プロジェクト全体の構造が理解しやすくなります。'
          : readingOrder[0].reasons.some(r => r.includes('Router') || r.includes('Controller'))
          ? ' 最初のファイルはプロジェクトの核となるルーティングやコントローラーです。ここから理解を始めるのが効率的です。'
          : ' 最初のファイルはプロジェクトの重要な要素です。ここから理解を始めることで、全体像が掴みやすくなります。'
        }
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
          📊 重要度スコアはエントリーポイント、依存関係、ファイルサイズ、技術的中核性を総合的に評価しています。
        </div>
      </div>
    </div>
  );
};

const ExecutionFlowAnalysis: React.FC<{ content: string; language: string }> = ({ content, language }) => {
  const analyzeExecutionFlow = () => {
    const flow = {
      entryPoints: [] as string[],
      dataFlow: [] as string[],
      apiCalls: [] as string[],
      eventHandlers: [] as string[],
      asyncOperations: [] as string[],
      dependencies: [] as string[]
    };
    
    // エントリーポイント検出
    const entryMatches = content.match(/(?:function\s+main|app\.listen|server\.listen|ReactDOM\.render|Vue\.createApp|angular\.bootstrap|document\.addEventListener|window\.onload|export\s+default|module\.exports)/g);
    if (entryMatches) {
      entryMatches.forEach(match => {
        const entry = match.replace(/.*function\s+|app\.|server\.|ReactDOM\.|Vue\.|angular\.|document\.|window\.|export\s+|module\./g, '').trim();
        if (entry) flow.entryPoints.push(entry);
      });
    }
    
    // データフロー分析
    const dataFlowPatterns = [
      { pattern: /useState|useEffect|useContext|useReducer/g, type: 'React Hooks' },
      { pattern: /this\.setState|this\.state|componentDidMount|componentDidUpdate/g, type: 'React Class Component' },
      { pattern: /data\s*=|setData|this\.data|\$data/g, type: 'Data Binding' },
      { pattern: /props\.|this\.props|attributes/g, type: 'Props Passing' },
      { pattern: /emit|dispatch|publish|next|resolve/g, type: 'Event System' }
    ];
    
    dataFlowPatterns.forEach(({ pattern, type }) => {
      const matches = content.match(pattern);
      if (matches) {
        flow.dataFlow.push(type);
      }
    });
    
    // API呼び出し検出
    const apiPatterns = [
      /fetch\s*\(/g,
      /axios\./g,
      /XMLHttpRequest/g,
      /\.get\s*\(/g,
      /\.post\s*\(/g,
      /\.put\s*\(/g,
      /\.delete\s*\(/g,
      /req\./g,
      /res\./g
    ];
    
    apiPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        flow.apiCalls.push(`API呼び出し (${pattern.source})`);
      }
    });
    
    // イベントハンドラ検出
    const eventPatterns = [
      /addEventListener/g,
      /onclick|onchange|onsubmit|onload/g,
      /\.on\s*\(/g,
      /handle\w+/g,
      /on\w+\s*=/g
    ];
    
    eventPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        flow.eventHandlers.push(`イベント処理 (${pattern.source})`);
      }
    });
    
    // 非同期処理検出
    const asyncPatterns = [
      /async\s+\w+/g,
      /await\s+/g,
      /Promise\./g,
      /\.then\s*\(/g,
      /callback/g,
      /setTimeout|setInterval/g
    ];
    
    asyncPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        flow.asyncOperations.push(`非同期処理 (${pattern.source})`);
      }
    });
    
    // 依存関係分析
    const importPatterns = [
      /import\s+.*from\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]/g,
      /@import/g
    ];
    
    importPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const dep = match.match(/from\s+['"]([^'"]+)['"]/)?.[1] || match.match(/require\s*\(\s*['"]([^'"]+)['"]/)?.[1];
          if (dep && !flow.dependencies.includes(dep)) {
            flow.dependencies.push(dep);
          }
        });
      }
    });
    
    return flow;
  };
  
  const flow = analyzeExecutionFlow();
  
  const getFlowDescription = () => {
    if (flow.entryPoints.length === 0) return 'エントリーポイントが不明';
    
    let description = `この${language}コードは「`;
    
    // メインパターン分析
    if (flow.entryPoints.includes('main') || flow.entryPoints.includes('app.listen')) {
      description += 'サーバーサイド実行';
    } else if (flow.entryPoints.includes('render') || flow.entryPoints.includes('createApp')) {
      description += 'クライアントサイド実行';
    } else if (flow.entryPoints.includes('addEventListener')) {
      description += 'イベント駆動';
    } else {
      description += 'モジュールベース';
    }
    
    description += '」で動作しており';
    
    // データフロー説明
    if (flow.dataFlow.length > 0) {
      description += `、「${flow.dataFlow.join('・')}」によるデータフローを持ち`;
    }
    
    // API説明
    if (flow.apiCalls.length > 0) {
      description += `、「${flow.apiCalls.slice(0, 3).join('・')}${flow.apiCalls.length > 3 ? 'など' : ''}」でAPI通信を行い`;
    }
    
    // 非同期処理説明
    if (flow.asyncOperations.length > 0) {
      description += `、「${flow.asyncOperations.slice(0, 2).join('・')}${flow.asyncOperations.length > 2 ? 'など' : ''}」の非同期処理を使用`;
    }
    
    description += '。';
    
    // アーキテクチャパターン
    if (flow.dependencies.length > 5) {
      description += '多くの外部ライブラリに依存する複雑なアーキテクチャです。';
    } else if (flow.asyncOperations.length > 2) {
      description += '非同期処理を多用するリアルタイム性の高いアプリケーションです。';
    } else if (flow.eventHandlers.length > 3) {
      description += 'イベント駆動型のインタラクティブなアプリケーションです。';
    } else {
      description += 'シンプルな構造のコードです。';
    }
    
    return description;
  };
  
  return (
    <div className="execution-flow-analysis" style={{ 
      backgroundColor: '#f5f5f5', 
      padding: '16px', 
      borderRadius: '8px', 
      marginTop: '16px' 
    }}>
      <h3>🔍 実行フロー分析</h3>
      
      {/* エントリーポイント */}
      <div style={{ marginBottom: '20px' }}>
        <h4>🚀 エントリーポイント</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {flow.entryPoints.length > 0 ? (
            flow.entryPoints.map((point, index) => (
              <span 
                key={index}
                style={{ 
                  backgroundColor: '#e6f7ff', 
                  padding: '6px 12px', 
                  borderRadius: '16px', 
                  fontSize: '14px',
                  fontWeight: 'bold'
                }}
              >
                {point}
              </span>
            ))
          ) : (
            <span style={{ color: '#666' }}>エントリーポイントが検出されませんでした</span>
          )}
        </div>
      </div>
      
      {/* データフロー */}
      <div style={{ marginBottom: '20px' }}>
        <h4>📊 データフロー</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {flow.dataFlow.length > 0 ? (
            flow.dataFlow.map((flowType, index) => (
              <span 
                key={index}
                style={{ 
                  backgroundColor: '#f0f0f0', 
                  padding: '4px 8px', 
                  borderRadius: '8px', 
                  fontSize: '12px',
                  border: '1px solid #d0d0d0'
                }}
              >
                {flowType}
              </span>
            ))
          ) : (
            <span style={{ color: '#666' }}>データフローが検出されませんでした</span>
          )}
        </div>
      </div>
      
      {/* API呼び出し */}
      <div style={{ marginBottom: '20px' }}>
        <h4>🌐 API通信</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {flow.apiCalls.length > 0 ? (
            flow.apiCalls.map((apiCall, index) => (
              <span 
                key={index}
                style={{ 
                  backgroundColor: '#fff2e8', 
                  padding: '4px 8px', 
                  borderRadius: '8px', 
                  fontSize: '12px',
                  border: '1px solid #d0d0d0'
                }}
              >
                {apiCall}
              </span>
            ))
          ) : (
            <span style={{ color: '#666' }}>API呼び出しが検出されませんでした</span>
          )}
        </div>
      </div>
      
      {/* 非同期処理 */}
      <div style={{ marginBottom: '20px' }}>
        <h4>⚡ 非同期処理</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {flow.asyncOperations.length > 0 ? (
            flow.asyncOperations.map((asyncOp, index) => (
              <span 
                key={index}
                style={{ 
                  backgroundColor: '#f6ffed', 
                  padding: '4px 8px', 
                  borderRadius: '8px', 
                  fontSize: '12px',
                  border: '1px solid #d0d0d0'
                }}
              >
                {asyncOp}
              </span>
            ))
          ) : (
            <span style={{ color: '#666' }}>非同期処理が検出されませんでした</span>
          )}
        </div>
      </div>
      
      {/* 依存関係 */}
      <div style={{ marginBottom: '20px' }}>
        <h4>📦 依存関係</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {flow.dependencies.length > 0 ? (
            flow.dependencies.slice(0, 10).map((dep, index) => (
              <span 
                key={index}
                style={{ 
                  backgroundColor: '#d9f7be', 
                  padding: '4px 8px', 
                  borderRadius: '8px', 
                  fontSize: '12px',
                  border: '1px solid #d0d0d0'
                }}
              >
                {dep}
              </span>
            ))
          ) : (
            <span style={{ color: '#666' }}>依存関係が検出されませんでした</span>
          )}
          {flow.dependencies.length > 10 && (
            <span style={{ color: '#666', fontStyle: 'italic' }}>
              ... 他{flow.dependencies.length - 10}件
            </span>
          )}
        </div>
      </div>
      
      {/* 実行フロー説明 */}
      <div style={{ 
        backgroundColor: 'white', 
        padding: '16px', 
        borderRadius: '8px', 
        border: '1px solid #e0e0e0',
        lineHeight: '1.6'
      }}>
        <h4>📋 実行フロー解説</h4>
        <p style={{ margin: 0, fontSize: '14px' }}>
          {getFlowDescription()}
        </p>
      </div>
    </div>
  );
};

// --- 比較体験コンポーネント ---
const ComparisonView: React.FC<{ history: AnalysisHistory[] }> = ({ history }) => {
  const getRecentComparisons = () => {
    if (history.length < 2) return [];
    
    // 最新2件を比較
    const latest = history[0];
    const previous = history[1];
    
    return [
      {
        type: 'risk',
        current: latest.riskScore,
        previous: previous.riskScore,
        change: latest.riskScore - previous.riskScore,
        label: 'リスクスコア'
      },
      {
        type: 'ai',
        current: latest.aiLikelihood,
        previous: previous.aiLikelihood,
        change: latest.aiLikelihood - previous.aiLikelihood,
        label: 'AI生成確率'
      },
      {
        type: 'size',
        current: latest.fullResult.lines || 0,
        previous: previous.fullResult.lines || 0,
        change: (latest.fullResult.lines || 0) - (previous.fullResult.lines || 0),
        label: 'コード行数'
      }
    ];
  };
  
  const comparisons = getRecentComparisons();
  
  if (comparisons.length === 0) return null;
  
  return (
    <div className="comparison-view" style={{
      backgroundColor: '#f0f8ff',
      padding: '20px',
      borderRadius: '12px',
      marginBottom: '24px',
      border: '2px solid #b3d9ff'
    }}>
      <h3 style={{ margin: '0 0 16px 0', color: '#0066cc', fontSize: '18px' }}>
        📊 変化の比較
      </h3>
      
      <div style={{ marginBottom: '16px', fontSize: '14px', color: '#666' }}>
        💡 前回の解析からの変化を確認できます
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        {comparisons.map((comp, index) => (
          <div 
            key={comp.type}
            style={{
              padding: '16px',
              backgroundColor: 'white',
              borderRadius: '8px',
              border: '1px solid #e0e0e0',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>
              {comp.label}
            </div>
            
            <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>
              {comp.current}
              {comp.type === 'ai' && '%'}
              {comp.type === 'size' && '行'}
            </div>
            
            <div style={{ 
              fontSize: '14px',
              fontWeight: 'bold',
              color: comp.change > 0 ? '#ff4d4f' : comp.change < 0 ? '#52c41a' : '#666'
            }}>
              {comp.change > 0 ? '↑' : comp.change < 0 ? '↓' : '→'} {Math.abs(comp.change)}
              {comp.type === 'ai' && '%'}
              {comp.type === 'size' && '行'}
            </div>
          </div>
        ))}
      </div>
      
      <div style={{
        marginTop: '16px',
        padding: '12px',
        backgroundColor: '#e6f3ff',
        borderRadius: '8px',
        fontSize: '14px',
        color: '#0066cc'
      }}>
        <strong>💡 変化の解釈:</strong> 
        {comparisons.find(c => c.type === 'risk')?.change && comparisons.find(c => c.type === 'risk')!.change > 0 
          ? ' リスクスコアが上昇しています。コードの複雑度が増加した可能性があります。'
          : comparisons.find(c => c.type === 'risk')?.change && comparisons.find(c => c.type === 'risk')!.change < 0
          ? ' リスクスコアが改善しています。コードの品質が向上した可能性があります。'
          : ' 前回から大きな変化はありません。'
        }
      </div>
    </div>
  );
};

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
          <div className="analysis-result">
            {/* プロジェクト要約ビュー */}
            <ProjectSummaryView 
              result={analysisResult} 
              fileName={analysisResult.fileName || selectedFile?.name || 'Unknown'} 
              content={fileContent}
            />

            {/* 比較体験 */}
            {history.length >= 2 && (
              <ComparisonView history={history} />
            )}

            {/* 読む順番ガイド */}
            <ReadingOrderGuide 
              files={analysisResult.files} 
              singleFile={analysisResult.type === 'single' ? analysisResult : undefined} 
            />

            {analysisResult.blackboxRisk && <RiskAnalysisView risk={analysisResult.blackboxRisk} />}

            <div className="summary-result">
              <div className="summary-stats">
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

              {/* 実行フロー分析 */}
              {analysisResult.type === 'single' && fileContent && (
                <ExecutionFlowAnalysis 
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
