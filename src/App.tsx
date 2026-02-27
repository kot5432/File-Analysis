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
import JSZip from 'jszip';

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
  unusedFunctions?: { count: number; riskScore: number };
  aiEstimation?: { 
    aiLikelihood: number; 
    confidence: number;
    reasons: string[];
    commentRate?: number;
    avgFunctionLength?: number;
    complexityScore?: number;
    namingConsistency?: number;
    importPattern?: string;
    errorHandling?: number;
  };
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
    const level = aiLikelihood >= 70 ? 'HIGH' : aiLikelihood >= 40 ? 'MEDIUM' : 'LOW';
    const color = aiLikelihood >= 70 ? '#ff4d4f' : aiLikelihood >= 40 ? '#faad14' : '#52c41a';
    const bgColor = aiLikelihood >= 70 ? '#fff2f0' : aiLikelihood >= 40 ? '#fffbe6' : '#f6ffed';
    const borderColor = aiLikelihood >= 70 ? '#ffccc7' : aiLikelihood >= 40 ? '#ffe58f' : '#b7eb8f';
    
    // AI判定根拠の収集
    const evidence: string[] = [];
    const aiEstimation = result.blackboxRisk?.aiEstimation;
    
    if (aiEstimation) {
      if (aiEstimation.commentRate !== undefined && aiEstimation.commentRate < 0.05) {
        evidence.push(`コメント率が低い (${Math.round(aiEstimation.commentRate * 100)}%)`);
      }
      if (aiEstimation.avgFunctionLength !== undefined && aiEstimation.avgFunctionLength > 50) {
        evidence.push(`関数が長い (平均${Math.round(aiEstimation.avgFunctionLength)}行)`);
      }
      if (aiEstimation.complexityScore !== undefined && aiEstimation.complexityScore > 70) {
        evidence.push(`複雑度が高い (${Math.round(aiEstimation.complexityScore)}/100)`);
      }
      if (aiEstimation.namingConsistency !== undefined && aiEstimation.namingConsistency < 0.7) {
        evidence.push(`命名規則が一貫性がない (${Math.round(aiEstimation.namingConsistency * 100)}%)`);
      }
      if (aiEstimation.importPattern !== undefined && aiEstimation.importPattern === 'uniform') {
        evidence.push('インポートパターンが均一');
      }
      if (aiEstimation.errorHandling !== undefined && aiEstimation.errorHandling < 0.3) {
        evidence.push(`エラーハンドリングが少ない (${Math.round(aiEstimation.errorHandling * 100)}%)`);
      }
    }
    
    return { 
      level, 
      color, 
      bgColor, 
      borderColor,
      evidence: evidence.length > 0 ? evidence : ['AI生成の可能性を検出'],
      confidence: Math.round(aiLikelihood)
    };
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
                <span style={{
                  fontSize: '10px',
                  color: '#666',
                  backgroundColor: '#f0f0f0',
                  padding: '2px 4px',
                  borderRadius: '3px'
                }}>
                  信頼度: {aiLevel.confidence}%
                </span>
              </div>
              
              {/* AI判定根拠 */}
              <div style={{ 
                fontSize: '10px', 
                color: '#666', 
                marginTop: '6px',
                backgroundColor: '#fafafa',
                border: '1px solid #e0e0e0',
                borderRadius: '4px',
                padding: '6px'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>🔍 検出根拠:</div>
                {aiLevel.evidence.map((evidence, index) => (
                  <div key={index} style={{ marginBottom: '1px' }}>• {evidence}</div>
                ))}
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
    const fileName = file.fileName.toLowerCase();
    
    // 🥇 ① エントリーポイント検出（最大 +40）
    if (fileName.includes('index') || fileName.includes('main') || fileName.includes('app')) {
      score += 40; // 明確なエントリ検出
    } else if (fileName.includes('router') || fileName.includes('routes') || fileName.includes('server')) {
      score += 25; // 準エントリ
    }
    
    // 🥈 ② import集中度（最大 +25）
    // エクスポート数をimport集中度の代理として使用
    const exportCount = file.structure.exports.length;
    if (exportCount >= 10) {
      score += 25; // import最多
    } else if (exportCount >= 5) {
      score += 15; // 中程度
    } else if (exportCount >= 2) {
      score += 5; // 低
    }
    
    // 🥉 ③ ファイルサイズ（最大 +15）
    // 「適度に大きい」を評価するカーブ
    const lines = file.lines;
    if (lines >= 300 && lines <= 800) {
      score += 15; // 最適サイズ
    } else if (lines >= 100 && lines < 300) {
      score += 10; // 小さいけど重要かも
    } else if (lines > 800 && lines <= 1500) {
      score += 8; // 大きいけど中核かも
    } else if (lines > 1500) {
      score += 3; // 巨大ファイル（減衰）
    }
    // 100行未満は加点なし
    
    // ④ 技術中枢シグナル（最大 +15）
    if (fileName.includes('component') || fileName.includes('components')) {
      score += 10; // React component
    } else if (fileName.includes('router') || fileName.includes('routes')) {
      score += 12; // Express router
    } else if (fileName.includes('controller') || fileName.includes('controllers')) {
      score += 12; // Controller層
    } else if (fileName.includes('service') || fileName.includes('services')) {
      score += 8; // Service層
    } else if (fileName.includes('view') || fileName.includes('views')) {
      score += 12; // Django view
    } else if (fileName.includes('config') || fileName.includes('configuration')) {
      score += 5; // 設定ファイル
    } else if (fileName.includes('util') || fileName.includes('utils') || fileName.includes('helper')) {
      score += 2; // ユーティリティ（低評価）
    }
    
    // ⑤ ブラックボックスリスク（最大 +5）
    if (file.blackboxRisk && file.blackboxRisk.score > 70) {
      score += 5; // 高リスク
    } else if (file.blackboxRisk && file.blackboxRisk.score > 40) {
      score += 2; // 中リスク
    }
    
    return Math.min(score, 100); // 上限100点
  };

  const getReasonTags = (file: FileAnalysis, score: number): string[] => {
    const tags: string[] = [];
    const fileName = file.fileName.toLowerCase();
    
    // エントリーポイント判定
    if (fileName.includes('index') || fileName.includes('main') || fileName.includes('app')) {
      tags.push('Entry Point');
    } else if (fileName.includes('router') || fileName.includes('routes') || fileName.includes('server')) {
      tags.push('Core Module');
    }
    
    // import集中度判定
    if (file.structure.exports.length >= 10) {
      tags.push('Highly Imported');
    }
    
    // ファイルサイズ判定
    const lines = file.lines;
    if (lines >= 300 && lines <= 800) {
      tags.push('Optimal Size');
    } else if (lines > 1500) {
      tags.push('Large File');
    }
    
    // 技術的中核判定
    if (fileName.includes('component') || fileName.includes('components')) {
      tags.push('Component');
    } else if (fileName.includes('router') || fileName.includes('routes')) {
      tags.push('Router Core');
    } else if (fileName.includes('controller') || fileName.includes('controllers')) {
      tags.push('Controller');
    } else if (fileName.includes('service') || fileName.includes('services')) {
      tags.push('Service Layer');
    } else if (fileName.includes('config') || fileName.includes('configuration')) {
      tags.push('Configuration');
    }
    
    // リスク判定
    if (file.blackboxRisk && file.blackboxRisk.score > 70) {
      tags.push('High Risk');
    }
    
    // 最大2-3タグに制限
    return tags.slice(0, 3);
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
        reasons: ['Single File']
      }];
    }
    
    if (!files) return [];
    
    const scoredFiles = files.map(file => ({
      file,
      score: calculateImportanceScore(file),
      reasons: getReasonTags(file, calculateImportanceScore(file))
    }));
    
    return scoredFiles.sort((a, b) => b.score - a.score).slice(0, 3); // Top 3に制限
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
                  width: `${item.score}%`,
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
          : readingOrder[0].reasons.some(r => r.includes('Core') || r.includes('Router') || r.includes('Controller'))
          ? ' 最初のファイルはプロジェクトの核となるモジュールです。ここから理解を始めるのが効率的です。'
          : ' 最初のファイルはプロジェクトの重要な要素です。ここから理解を始めることで、全体像が掴みやすくなります。'
        }
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
          📊 重要度スコア: エントリーポイント(40点) + import集中度(25点) + ファイルサイズ(15点) + 技術シグナル(15点) + リスク(5点) = 最大100点
        </div>
      </div>
    </div>
  );
};

// --- 改善提案型定義 ---
interface Suggestion {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  why: string;
  actions: string[];
  priority: number;
  autoFixable?: boolean;
}

// --- 改善提案生成エンジン ---
const generateSuggestions = (analysis: AnalysisResult): Suggestion[] => {
  const suggestions: Suggestion[] = [];
  
  if (analysis.type === 'single' && analysis.blackboxRisk) {
    const risk = analysis.blackboxRisk;
    const structure = analysis.structure;
    
    // ネスト深度チェック
    if (risk.breakdown?.nestingDepth && risk.breakdown.nestingDepth >= 6) {
      suggestions.push({
        id: 'deep_nesting',
        type: 'deep_nesting',
        severity: 'high',
        title: '⚠️ ネストが深すぎます',
        description: `この関数はネスト深度${risk.breakdown.nestingDepth}で、可読性が著しく低下しています`,
        why: '深いネストはコードの理解を困難にし、バグの温床になります。特に条件分岐が複雑になると、どのケースで何が起こるか追跡できなくなります。',
        actions: [
          '早期returnを使ってネストを浅くする',
          '関数を複数に分割して責任を分ける',
          'ガード節を導入して早期に処理を終了させる',
          '条件式を変数に抽出して可読性を向上させる'
        ],
        priority: 1,
        autoFixable: false
      });
    } else if (risk.breakdown?.nestingDepth && risk.breakdown.nestingDepth >= 4) {
      suggestions.push({
        id: 'moderate_nesting',
        type: 'deep_nesting',
        severity: 'medium',
        title: '🟡 ネストがやや深いです',
        description: `ネスト深度${risk.breakdown.nestingDepth}で、改善の余地があります`,
        why: '現在の状態でも動作しますが、将来的な保守性を考えると改善しておくのが望ましいです。',
        actions: [
          '早期returnの導入を検討する',
          '条件分岐を簡潔に書き直す'
        ],
        priority: 3,
        autoFixable: false
      });
    }
    
    // コメント率チェック
    if (risk.breakdown?.commentRate !== undefined && risk.breakdown.commentRate < 0.1) {
      suggestions.push({
        id: 'low_comments',
        type: 'low_comments',
        severity: 'high',
        title: '📝 コメントが不足しています',
        description: `コメント率は${Math.round(risk.breakdown.commentRate * 100)}%で、ドキュメンテーションが不十分です`,
        why: 'コメントが不足すると、他の開発者（将来の自分も含む）がコードの意図を理解できず、保守性が低下します。特に複雑なロジックには説明が必要です。',
        actions: [
          '関数の目的を説明するコメントを追加する',
          '複雑な処理には行単位のコメントを入れる',
          'JSDoc形式で関数の引数と戻り値を文書化する',
          'ビジネスルールや制約事項をコメントで明記する'
        ],
        priority: 2,
        autoFixable: false
      });
    } else if (risk.breakdown?.commentRate !== undefined && risk.breakdown.commentRate < 0.2) {
      suggestions.push({
        id: 'moderate_comments',
        type: 'low_comments',
        severity: 'medium',
        title: '📝 コメントを増やすことを検討してください',
        description: `コメント率は${Math.round(risk.breakdown.commentRate * 100)}%です`,
        why: '現状でも問題ありませんが、より良い保守性のためにコメントを追加することをお勧めします。',
        actions: [
          '主要な関数に説明コメントを追加する',
          '複雑な処理部分に補足説明を入れる'
        ],
        priority: 4,
        autoFixable: false
      });
    }
    
    // ファイルサイズチェック
    if (analysis.lines && analysis.lines > 600) {
      suggestions.push({
        id: 'large_file',
        type: 'large_file',
        severity: 'medium',
        title: '📁 ファイルが大きいです',
        description: `このファイルは${analysis.lines.toLocaleString()}行で、管理が困難になりつつあります`,
        why: '大きなファイルは特定の機能を見つけにくく、変更時の影響範囲が広くなりがちです。また、コンフリクトの原因にもなります。',
        actions: [
          '関連する機能を別のファイルに分割する',
          'クラスやモジュール単位でファイルを整理する',
          '設定ファイルや定数ファイルを分離する',
          '単一責任の原則に従って関数をグループ化する'
        ],
        priority: 3,
        autoFixable: false
      });
    }
    
    // 未使用関数チェック
    if (structure && structure.functions && structure.functions.length > 0) {
      const unusedCount = Math.max(0, structure.functions.length - 5); // 簡易的な判定
      if (unusedCount >= 3) {
        suggestions.push({
          id: 'unused_functions',
          type: 'unused_functions',
          severity: 'medium',
          title: '🔍 未使用の関数があります',
          description: `${unusedCount}個の関数が未使用の可能性があります`,
          why: '未使用のコードはコードベースを複雑にし、混乱の原因になります。また、セキュリティリスクの原因になることもあります。',
          actions: [
            '本当に不要な関数は削除する',
            'テストでしか使われていない関数を別ファイルに移動する',
            '将来使う可能性がある関数にはコメントを残す',
            '動的インポートが必要な関数は明示的にマークする'
          ],
          priority: 5,
          autoFixable: true
        });
      }
    }
    
    // 関数の複雑度チェック
    if (structure && structure.functions && structure.functions.length > 20) {
      suggestions.push({
        id: 'too_many_functions',
        type: 'too_many_functions',
        severity: 'medium',
        title: '🔧 関数が多すぎます',
        description: `このファイルには${structure.functions.length}個の関数があります`,
        why: '多くの関数が1つのファイルに集まっていると、ファイルの責任範囲が曖昧になり、保守性が低下します。',
        actions: [
          '機能単位でファイルを分割する',
          '関連する関数をクラスやモジュールにまとめる',
          'ユーティリティ関数は別ファイルに移動する',
          'エクスポートする関数だけを残し、それ以外はプライベートにする'
        ],
        priority: 4,
        autoFixable: false
      });
    }
    
    // クラスの複雑度チェック
    if (structure && structure.classes && structure.classes.length > 5) {
      suggestions.push({
        id: 'too_many_classes',
        type: 'too_many_classes',
        severity: 'medium',
        title: '🏗️ クラスが多すぎます',
        description: `このファイルには${structure.classes.length}個のクラスがあります`,
        why: '1ファイルに多くのクラスがあると、ファイルの目的が不明確になり、見つけにくくなります。',
        actions: [
          'クラス単位でファイルを分割する',
          '関連するクラスを同じディレクトリにまとめる',
          '抽象クラスやインターフェースは別ファイルにする'
        ],
        priority: 4,
        autoFixable: false
      });
    }
  }
  
  // ZIPファイルの場合の提案
  if (analysis.type === 'zip' && analysis.files) {
    // 高リスクファイルの警告
    const highRiskFiles = analysis.files.filter(f => f.blackboxRisk && f.blackboxRisk.score > 70);
    if (highRiskFiles.length > 0) {
      suggestions.push({
        id: 'high_risk_files',
        type: 'high_risk_files',
        severity: 'high',
        title: '⚠️ 高リスクファイルがあります',
        description: `${highRiskFiles.length}個のファイルが高リスクと判定されました`,
        why: '高リスクファイルはバグの温床になりやすく、プロジェクト全体の品質に影響を与える可能性があります。',
        actions: [
          '高リスクファイルから優先的に改善する',
          'リファクタリングの対象として計画に含める',
          'テストカバレッジを向上させる',
          'コードレビューで重点的に確認する'
        ],
        priority: 1,
        autoFixable: false
      });
    }
    
    // プロジェクト規模の警告
    if (analysis.totalFiles && analysis.totalFiles > 50) {
      suggestions.push({
        id: 'large_project',
        type: 'large_project',
        severity: 'medium',
        title: '📂 プロジェクトが大規模です',
        description: `このプロジェクトは${analysis.totalFiles}個のファイルを含みます`,
        why: '大規模プロジェクトでは、適切な構造化とドキュメンテーションが重要になります。',
        actions: [
          'アーキテクチャ図を作成する',
          'READMEやドキュメントを整備する',
          'コーディング規約を統一する',
          '自動テストを導入する'
        ],
        priority: 6,
        autoFixable: false
      });
    }
  }
  
  // 優先度でソート
  return suggestions.sort((a, b) => a.priority - b.priority);
};

// --- 改善提案表示コンポーネント ---
const ImprovementSuggestions: React.FC<{ analysis: AnalysisResult }> = ({ analysis }) => {
  const suggestions = generateSuggestions(analysis);
  
  if (suggestions.length === 0) {
    return (
      <div style={{
        backgroundColor: '#f6ffed',
        border: '1px solid #b7eb8f',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '24px'
      }}>
        <h3 style={{ margin: '0 0 8px 0', color: '#52c41a', fontSize: '16px' }}>
          ✅ 改善提案
        </h3>
        <p style={{ margin: 0, fontSize: '14px', color: '#52c41a' }}>
          現在、特に改善の必要はありません。コード品質は良好です！
        </p>
      </div>
    );
  }
  
  const topSuggestions = suggestions.slice(0, 3);
  const severityColors = {
    high: '#ff4d4f',
    medium: '#faad14',
    low: '#52c41a'
  };
  
  return (
    <div style={{
      backgroundColor: '#fafafa',
      border: '1px solid #d9d9d9',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '24px'
    }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600', color: '#262626' }}>
        🔧 改善提案
      </h3>
      
      {/* TOP3の優先提案 */}
      <div style={{ marginBottom: '24px' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          🎯 今すぐ対応すべきTOP3
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {topSuggestions.map((suggestion, index) => (
            <div 
              key={suggestion.id}
              style={{
                backgroundColor: 'white',
                border: `2px solid ${severityColors[suggestion.severity]}`,
                borderRadius: '8px',
                padding: '16px',
                position: 'relative'
              }}
            >
              <div style={{
                position: 'absolute',
                top: '-10px',
                left: '16px',
                backgroundColor: severityColors[suggestion.severity],
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 'bold'
              }}>
                TOP {index + 1}
              </div>
              
              <div style={{ marginTop: '4px' }}>
                <h5 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 'bold', color: '#262626' }}>
                  {suggestion.title}
                </h5>
                <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#595959', lineHeight: '1.4' }}>
                  {suggestion.description}
                </p>
                <div style={{ marginBottom: '12px' }}>
                  <strong style={{ color: '#262626' }}>なぜ危険か：</strong>
                  <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#666', lineHeight: '1.4' }}>
                    {suggestion.why}
                  </p>
                </div>
                <div>
                  <strong style={{ color: '#262626' }}>改善方法：</strong>
                  <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px' }}>
                    {suggestion.actions.map((action, actionIndex) => (
                      <li key={actionIndex} style={{ fontSize: '13px', color: '#666', marginBottom: '4px', lineHeight: '1.4' }}>
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
                {suggestion.autoFixable && (
                  <div style={{ marginTop: '12px' }}>
                    <span style={{
                      backgroundColor: '#e6f7ff',
                      color: '#1890ff',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      🤖 自動修正可能
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* 全提案リスト */}
      {suggestions.length > 3 && (
        <div>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            📋 全ての改善提案
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {suggestions.slice(3).map((suggestion) => (
              <div 
                key={suggestion.id}
                style={{
                  backgroundColor: 'white',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}
              >
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: severityColors[suggestion.severity],
                  flexShrink: 0
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
                    {suggestion.title}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    {suggestion.description}
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: '#8c8c8c' }}>
                  優先度: {suggestion.priority}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Fix提案型定義 ---
interface FixSuggestion {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  estimatedEffort?: 'low' | 'medium' | 'high';
}

// --- Issue → Fix ルールエンジン ---
const FIX_RULES: Record<string, FixSuggestion[]> = {
  deep_nesting: [
    {
      title: '関数を分割してネストを浅くする',
      description: '大きな関数を複数の小さな関数に分割し、早期returnやガード節を導入してネスト深度を減らします',
      priority: 'high',
      estimatedEffort: 'medium'
    },
    {
      title: '早期returnパターンを導入する',
      description: '条件分岐の先にreturn文を配置して、ネストを浅くするリファクタリング手法を適用します',
      priority: 'high',
      estimatedEffort: 'low'
    },
    {
      title: '条件式を変数に抽出する',
      description: '複雑な条件式を意味のある変数に抽出して、コードの可読性を向上させます',
      priority: 'medium',
      estimatedEffort: 'low'
    }
  ],
  large_file: [
    {
      title: 'ファイルを機能単位に分割する',
      description: '関連する機能を別のファイルに分離し、単一責任の原則に従ってファイルを整理します',
      priority: 'high',
      estimatedEffort: 'high'
    },
    {
      title: 'クラスやモジュールに整理する',
      description: '関連する関数をクラスやモジュールにまとめて、コードの構造を改善します',
      priority: 'medium',
      estimatedEffort: 'medium'
    },
    {
      title: '設定ファイルを分離する',
      description: '定数や設定値を別のファイルに移動して、メインファイルのサイズを削減します',
      priority: 'low',
      estimatedEffort: 'low'
    }
  ],
  low_comment_ratio: [
    {
      title: '関数の目的を説明するコメントを追加する',
      description: '各関数の先頭にJSDoc形式で目的、引数、戻り値を文書化します',
      priority: 'high',
      estimatedEffort: 'medium'
    },
    {
      title: '複雑な処理に行コメントを追加する',
      description: 'ビジネスロジックや複雑な処理部分に、なぜそう実装しているかを説明するコメントを追加します',
      priority: 'medium',
      estimatedEffort: 'medium'
    },
    {
      title: 'APIエンドポイントを文書化する',
      description: '公開されているAPIや関数について、使用方法や制約事項をコメントで明記します',
      priority: 'low',
      estimatedEffort: 'low'
    }
  ],
  dead_code: [
    {
      title: '未使用関数を削除する',
      description: '本当に使用されていない関数を安全に削除して、コードベースを整理します',
      priority: 'medium',
      estimatedEffort: 'low'
    },
    {
      title: 'テスト用コードを別ファイルに移動する',
      description: 'テストでのみ使用されている関数を、テストファイルに移動して本番コードをクリーンにします',
      priority: 'low',
      estimatedEffort: 'low'
    }
  ],
  too_many_functions: [
    {
      title: '機能カテゴリでファイルを分割する',
      description: '関連する機能グループごとにファイルを分割して、各ファイルの責任範囲を明確にします',
      priority: 'high',
      estimatedEffort: 'high'
    },
    {
      title: 'ユーティリティ関数を別ファイルに移動する',
      description: '共通で使用されるユーティリティ関数を専用ファイルに移動して、メインファイルを整理します',
      priority: 'medium',
      estimatedEffort: 'medium'
    }
  ],
  too_many_classes: [
    {
      title: 'クラス単位でファイルを分割する',
      description: '1ファイルに複数のクラスがある場合、各クラスを別のファイルに分割します',
      priority: 'high',
      estimatedEffort: 'medium'
    },
    {
      title: '関連クラスをディレクトリにまとめる',
      description: '論理的に関連するクラスを同じディレクトリに配置して、プロジェクト構造を改善します',
      priority: 'medium',
      estimatedEffort: 'low'
    }
  ],
  ai_generated_likely: [
    {
      title: '人間によるコードレビューを実施する',
      description: 'AI生成コードは品質にばらつきがあるため、人間による詳細なレビューが必要です',
      priority: 'high',
      estimatedEffort: 'medium'
    },
    {
      title: 'テストカバレッジを強化する',
      description: 'AI生成コードの動作を保証するため、包括的なテストを追加します',
      priority: 'medium',
      estimatedEffort: 'high'
    },
    {
      title: 'セキュリティレビューを実施する',
      description: 'AI生成コードには意図しない脆弱性が含まれる可能性があるため、セキュリティ専門家によるレビューを実施します',
      priority: 'high',
      estimatedEffort: 'medium'
    }
  ]
};

// --- Issueキー正規化 ---
const normalizeIssueKey = (issue: string): string => {
  const issueMap: Record<string, string> = {
    'Deep nesting': 'deep_nesting',
    'Large file': 'large_file',
    'Low comments': 'low_comment_ratio',
    'Few comments': 'low_comment_ratio',
    'Unused functions': 'dead_code',
    'Many functions': 'too_many_functions',
    'Too many classes': 'too_many_classes',
    'AI generated likely': 'ai_generated_likely',
    'AI generated possible': 'ai_generated_likely',
    'Moderate nesting': 'deep_nesting',
    'Moderate size': 'large_file',
    'Some unused functions': 'dead_code'
  };
  
  return issueMap[issue] || issue.toLowerCase().replace(/\s+/g, '_');
};

// --- Fix提案生成エンジン ---
const generateFixSuggestions = (issues: string[]): FixSuggestion[] => {
  const allFixes: FixSuggestion[] = [];
  
  issues.forEach(issue => {
    const normalizedKey = normalizeIssueKey(issue);
    const fixes = FIX_RULES[normalizedKey];
    
    if (fixes) {
      allFixes.push(...fixes);
    }
  });
  
  // 優先度でソート
  const priorityOrder = { high: 3, medium: 2, low: 1 };
  return allFixes.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
};

// --- FileRisk型を拡張して再定義 ---
interface FileRiskWithFixes {
  path: string;
  language: string;
  lines: number;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  issues: string[];
  fixes: FixSuggestion[];
}

// --- 拡張されたファイルリスクデータ生成 ---
const generateFileRisksWithFixes = (analysis: AnalysisResult): FileRiskWithFixes[] => {
  if (analysis.type !== 'zip' || !analysis.files) {
    return [];
  }
  
  return analysis.files.map(file => {
    const riskScore = calculateFileRiskScore(file);
    const riskLevel = getRiskLevel(riskScore);
    
    // issuesを生成
    const issues: string[] = [];
    if (file.blackboxRisk?.breakdown?.nestingDepth && file.blackboxRisk.breakdown.nestingDepth >= 6) {
      issues.push('Deep nesting');
    } else if (file.blackboxRisk?.breakdown?.nestingDepth && file.blackboxRisk.breakdown.nestingDepth >= 4) {
      issues.push('Moderate nesting');
    }
    if (file.blackboxRisk?.breakdown?.commentRate !== undefined && file.blackboxRisk.breakdown.commentRate < 0.1) {
      issues.push('Low comments');
    } else if (file.blackboxRisk?.breakdown?.commentRate !== undefined && file.blackboxRisk.breakdown.commentRate < 0.2) {
      issues.push('Few comments');
    }
    if (file.lines > 600) {
      issues.push('Large file');
    } else if (file.lines > 300) {
      issues.push('Moderate size');
    }
    if (file.structure.functions && file.structure.functions.length > 5) {
      const unusedCount = Math.max(0, file.structure.functions.length - 5);
      if (unusedCount >= 3) {
        issues.push('Unused functions');
      } else if (unusedCount >= 1) {
        issues.push('Some unused functions');
      }
    }
    if (file.structure.functions && file.structure.functions.length > 20) {
      issues.push('Many functions');
    }
    if (file.structure.classes && file.structure.classes.length > 5) {
      issues.push('Too many classes');
    }
    if (file.blackboxRisk?.aiEstimation?.aiLikelihood && file.blackboxRisk.aiEstimation.aiLikelihood >= 70) {
      issues.push('AI generated likely');
    } else if (file.blackboxRisk?.aiEstimation?.aiLikelihood && file.blackboxRisk.aiEstimation.aiLikelihood >= 40) {
      issues.push('AI generated possible');
    }
    
    // fixesを生成
    const fixes = generateFixSuggestions(issues);
    
    return {
      path: file.fileName,
      language: file.language,
      lines: file.lines,
      riskScore,
      riskLevel,
      issues,
      fixes
    };
  }).sort((a, b) => b.riskScore - a.riskScore);
};

// --- Quick Fixコピー機能 ---
const generateRefactorPrompt = (filePath: string, issues: string[], fixes: FixSuggestion[]): string => {
  const highPriorityFixes = fixes.filter(f => f.priority === 'high');
  
  let prompt = `// Refactor ${filePath}\n`;
  prompt += `// Issues: ${issues.join(', ')}\n\n`;
  
  highPriorityFixes.forEach((fix, index) => {
    prompt += `// Fix ${index + 1}: ${fix.title}\n`;
    prompt += `// ${fix.description}\n\n`;
  });
  
  prompt += `// Please implement these fixes while maintaining the original functionality.\n`;
  prompt += `// Focus on code readability, maintainability, and best practices.\n`;
  
  return prompt;
};

// --- ファイルリスク計算エンジン ---
const calculateFileRiskScore = (file: FileAnalysis): number => {
  let score = 0;
  const issues: string[] = [];
  
  // ネスト深度リスク
  if (file.blackboxRisk?.breakdown?.nestingDepth) {
    const nesting = file.blackboxRisk.breakdown.nestingDepth;
    if (nesting >= 6) {
      score += 30;
      issues.push('Deep nesting');
    } else if (nesting >= 4) {
      score += 15;
      issues.push('Moderate nesting');
    }
  }
  
  // コメント不足リスク
  if (file.blackboxRisk?.breakdown?.commentRate !== undefined) {
    const commentRate = file.blackboxRisk.breakdown.commentRate;
    if (commentRate < 0.1) {
      score += 25;
      issues.push('Low comments');
    } else if (commentRate < 0.2) {
      score += 10;
      issues.push('Few comments');
    }
  }
  
  // ファイル肥大リスク
  if (file.lines > 600) {
    score += 20;
    issues.push('Large file');
  } else if (file.lines > 300) {
    score += 10;
    issues.push('Moderate size');
  }
  
  // 未使用関数リスク
  if (file.structure.functions && file.structure.functions.length > 5) {
    const unusedCount = Math.max(0, file.structure.functions.length - 5);
    if (unusedCount >= 3) {
      score += 15;
      issues.push('Unused functions');
    } else if (unusedCount >= 1) {
      score += 5;
      issues.push('Some unused functions');
    }
  }
  
  // AI生成推定補正
  if (file.blackboxRisk?.aiEstimation?.aiLikelihood) {
    const aiLikelihood = file.blackboxRisk.aiEstimation.aiLikelihood;
    if (aiLikelihood >= 70) {
      score += 10;
      issues.push('AI generated likely');
    } else if (aiLikelihood >= 40) {
      score += 5;
      issues.push('AI generated possible');
    }
  }
  
  // 0-100に正規化
  return Math.min(score, 100);
};

// --- リスクレベル分類 ---
const getRiskLevel = (score: number): 'low' | 'medium' | 'high' => {
  if (score >= 67) return 'high';
  if (score >= 34) return 'medium';
  return 'low';
};

// --- ヒートマップ表示コンポーネント（Fix提案付き）---
const RiskHeatmapWithFixes: React.FC<{ analysis: AnalysisResult }> = ({ analysis }) => {
  const fileRisks = generateFileRisksWithFixes(analysis);
  
  if (fileRisks.length === 0) {
    return null;
  }
  
  // 最初に直すべき3ファイルを抽出
  const top3Files = fileRisks.slice(0, 3);
  
  // リスクレベルの色とアイコン
  const riskConfig = {
    high: { color: '#ff4d4f', bgColor: '#fff2f0', icon: '🔴' },
    medium: { color: '#faad14', bgColor: '#fffbe6', icon: '🟠' },
    low: { color: '#52c41a', bgColor: '#f6ffed', icon: '🟢' }
  };
  
  // Quick Fixコピー機能
  const handleCopyPrompt = (filePath: string, issues: string[], fixes: FixSuggestion[]) => {
    const prompt = generateRefactorPrompt(filePath, issues, fixes);
    navigator.clipboard.writeText(prompt).then(() => {
      // コピー成功のフィードバック（簡易版）
      alert('リファクタリングプロンプトをコピーしました！');
    });
  };
  
  return (
    <div style={{
      backgroundColor: '#fafafa',
      border: '1px solid #d9d9d9',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '24px'
    }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600', color: '#262626' }}>
        🗺️ リスクヒートマップ & 修正提案
      </h3>
      
      <div style={{ marginBottom: '20px', fontSize: '14px', color: '#666', lineHeight: '1.4' }}>
        💡 プロジェクトの危険分布と具体的な修正提案を表示。赤いファイルから優先的に改善しましょう。
      </div>
      
      {/* 最初に直すべき3ファイル */}
      <div style={{ marginBottom: '24px' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          🎯 最初に直すべき3ファイル
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {top3Files.map((file, index) => {
            const config = riskConfig[file.riskLevel];
            return (
              <div 
                key={file.path}
                style={{
                  backgroundColor: config.bgColor,
                  border: `1px solid ${config.color}`,
                  borderRadius: '8px',
                  padding: '16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
                  <div style={{
                    fontSize: '16px',
                    fontWeight: 'bold',
                    color: config.color,
                    flexShrink: 0
                  }}>
                    {config.icon} TOP {index + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
                      {file.path}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
                      Risk: {file.riskScore} • {file.lines} lines • {file.language}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      Issues: {file.issues.join(' • ')}
                    </div>
                  </div>
                </div>
                
                {/* 修正提案セクション */}
                <div style={{ 
                  backgroundColor: 'white', 
                  border: '1px solid #e0e0e0', 
                  borderRadius: '6px', 
                  padding: '12px',
                  marginBottom: '12px'
                }}>
                  <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '8px', color: '#262626' }}>
                    💡 Suggested Fixes
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {file.fixes.slice(0, 3).map((fix, fixIndex) => {
                      const priorityConfig = {
                        high: { color: '#ff4d4f', label: 'HIGH' },
                        medium: { color: '#faad14', label: 'MED' },
                        low: { color: '#52c41a', label: 'LOW' }
                      };
                      const pConfig = priorityConfig[fix.priority];
                      
                      return (
                        <div key={fixIndex} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                          <span style={{
                            backgroundColor: pConfig.color,
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            flexShrink: 0,
                            marginTop: '2px'
                          }}>
                            {pConfig.label}
                          </span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '2px' }}>
                              {fix.title}
                            </div>
                            <div style={{ fontSize: '11px', color: '#666', lineHeight: '1.3' }}>
                              {fix.description}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {/* Quick Fixボタン */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => handleCopyPrompt(file.path, file.issues, file.fixes)}
                    style={{
                      backgroundColor: '#1890ff',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 16px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#40a9ff'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#1890ff'}
                  >
                    📋 Copy refactor prompt
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* ヒートマップグリッド */}
      <div>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          📁 ファイルリスク分布
        </h4>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: '8px',
          maxHeight: '400px',
          overflowY: 'auto'
        }}>
          {fileRisks.map((file) => {
            const config = riskConfig[file.riskLevel];
            
            return (
              <div
                key={file.path}
                style={{
                  backgroundColor: config.bgColor,
                  border: `2px solid ${config.color}`,
                  borderRadius: '8px',
                  padding: '8px',
                  height: '100px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  position: 'relative',
                  minWidth: '80px',
                  maxWidth: '200px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                  e.currentTarget.style.zIndex = '10';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.zIndex = '1';
                }}
                title={`${file.path}\nRisk: ${file.riskScore}\nLines: ${file.lines}\nIssues: ${file.issues.join(', ')}\nFixes: ${file.fixes.length} suggestions`}
              >
                <div style={{
                  fontSize: '20px',
                  marginBottom: '4px',
                  lineHeight: '1'
                }}>
                  {config.icon}
                </div>
                <div style={{
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: config.color,
                  marginBottom: '2px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  width: '100%',
                  padding: '0 2px'
                }}>
                  {file.path.split('/').pop()}
                </div>
                <div style={{
                  fontSize: '10px',
                  color: '#666',
                  marginBottom: '2px'
                }}>
                  Risk: {file.riskScore}
                </div>
                <div style={{
                  fontSize: '9px',
                  color: '#888'
                }}>
                  {file.fixes.length} fixes
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* 凡例 */}
      <div style={{ marginTop: '16px', display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {Object.entries(riskConfig).map(([level, config]) => (
          <div key={level} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '2px',
              backgroundColor: config.color
            }} />
            <span style={{ fontSize: '12px', color: '#666' }}>
              {level.toUpperCase()} ({level === 'high' ? '67-100' : level === 'medium' ? '34-66' : '0-33'})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- プロジェクト健全性スコア型定義 ---
interface ProjectHealthScore {
  score: number;
  level: 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL';
  breakdown: {
    avgRiskScore: number;
    highRiskFileRatio: number;
    avgNestingDepth: number;
    avgCommentRatio: number;
    avgAiLikelihood: number;
  };
  recommendations: string[];
}

// --- 健全性レベル分類 ---
const getHealthLevel = (score: number): { level: string; color: string; icon: string } => {
  if (score >= 80) return { level: 'EXCELLENT', color: '#52c41a', icon: '🟢' };
  if (score >= 65) return { level: 'GOOD', color: '#a0d911', icon: '🟡' };
  if (score >= 45) return { level: 'WARNING', color: '#faad14', icon: '🟠' };
  return { level: 'CRITICAL', color: '#ff4d4f', icon: '🔴' };
};

// --- プロジェクト健全性スコア計算エンジン ---
const calculateProjectHealthScore = (analysis: AnalysisResult): ProjectHealthScore | null => {
  if (analysis.type !== 'zip' || !analysis.files || analysis.files.length === 0) {
    return null;
  }
  
  const files = analysis.files;
  
  // Step 6-1: ZIP全体集計
  const totalRiskScore = files.reduce((sum, file) => sum + calculateFileRiskScore(file), 0);
  const avgRiskScore = totalRiskScore / files.length;
  
  const highRiskFiles = files.filter(file => {
    const score = calculateFileRiskScore(file);
    return score >= 67; // HIGHリスク基準
  });
  const highRiskFileRatio = highRiskFiles.length / files.length;
  
  const nestingDepths = files
    .map(file => file.blackboxRisk?.breakdown?.nestingDepth || 0)
    .filter(depth => depth > 0);
  const avgNestingDepth = nestingDepths.length > 0 
    ? nestingDepths.reduce((sum, depth) => sum + depth, 0) / nestingDepths.length 
    : 0;
  
  const commentRatios = files
    .map(file => file.blackboxRisk?.breakdown?.commentRate || 0)
    .filter(ratio => ratio >= 0);
  const avgCommentRatio = commentRatios.length > 0
    ? commentRatios.reduce((sum, ratio) => sum + ratio, 0) / commentRatios.length
    : 0;
  
  const aiLikelihoods = files
    .map(file => file.blackboxRisk?.aiEstimation?.aiLikelihood || 0)
    .filter(likelihood => likelihood >= 0);
  const avgAiLikelihood = aiLikelihoods.length > 0
    ? aiLikelihoods.reduce((sum, likelihood) => sum + likelihood, 0) / aiLikelihoods.length
    : 0;
  
  // Step 6-2: 正規化（重要）
  // リスクスコア（そのまま、高いほど悪い）
  const riskNorm = avgRiskScore;
  
  // ハイリスクファイル率（そのまま、高いほど悪い）
  const highRiskNorm = highRiskFileRatio * 100;
  
  // ネスト深度（8を上限として正規化、高いほど悪い）
  const nestNorm = Math.min((avgNestingDepth / 8) * 100, 100);
  
  // コメント率（逆指標、低いほど悪い）
  const commentNorm = 100 - (avgCommentRatio * 100);
  
  // AI生成確率（そのまま、高いほど悪い）
  const aiNorm = avgAiLikelihood;
  
  // Step 6-3: 重み付き合算
  const healthScore = Math.max(0, Math.min(100,
    100 - (
      riskNorm * 0.35 +           // 平均リスクスコア（35%）
      highRiskNorm * 0.25 +       // ハイリスクファイル率（25%）
      nestNorm * 0.15 +           // 平均ネスト深度（15%）
      commentNorm * 0.15 +        // コメント率（15%）
      aiNorm * 0.10               // AI生成平均確率（10%）
    )
  ));
  
  // レベル判定
  const { level } = getHealthLevel(healthScore);
  
  // 推奨事項生成
  const recommendations: string[] = [];
  if (avgRiskScore >= 50) {
    recommendations.push('全体的なリスクスコアが高いため、優先的に改善が必要です');
  }
  if (highRiskFileRatio >= 0.2) {
    recommendations.push(`ハイリスクファイルが${Math.round(highRiskFileRatio * 100)}%あります。これらのファイルから改善を始めましょう`);
  }
  if (avgNestingDepth >= 4) {
    recommendations.push('ネストが深いファイルが多いです。関数分割や早期returnを検討してください');
  }
  if (avgCommentRatio < 0.15) {
    recommendations.push('コメント率が低いです。ドキュメンテーションの改善を検討してください');
  }
  if (avgAiLikelihood >= 50) {
    recommendations.push('AI生成コードの割合が高いです。人間によるレビューを強化してください');
  }
  if (recommendations.length === 0) {
    recommendations.push('プロジェクトの健全性は良好です。現在の品質を維持してください');
  }
  
  return {
    score: Math.round(healthScore),
    level: level as 'EXCELLENT' | 'GOOD' | 'WARNING' | 'CRITICAL',
    breakdown: {
      avgRiskScore: Math.round(avgRiskScore),
      highRiskFileRatio: Math.round(highRiskFileRatio * 100),
      avgNestingDepth: Math.round(avgNestingDepth * 10) / 10,
      avgCommentRatio: Math.round(avgCommentRatio * 100),
      avgAiLikelihood: Math.round(avgAiLikelihood)
    },
    recommendations
  };
};

// --- 改善インパクト予測（削除）---
// calculateImprovementImpactはUIに統合されているため未使用

// --- プロジェクト健全性スコア計算関数（削除）---
// ProjectHealthScoreViewはUIに統合されているため、このコンポーネントは未使用

// --- 技術的負債ヒートマップ型定義 ---
interface TechDebtFile {
  path: string;
  riskScore: number;
  heatLevel: 'low' | 'medium' | 'high';
  lines: number;
  language: string;
  size: number;
}

// --- ヒートレベル計算 ---
const calculateHeatLevel = (riskScore: number): 'low' | 'medium' | 'high' => {
  if (riskScore >= 70) return 'high';
  if (riskScore >= 40) return 'medium';
  return 'low';
};

// --- 技術的負債データ生成 ---
const generateTechDebtData = (analysis: AnalysisResult): TechDebtFile[] => {
  if (analysis.type !== 'zip' || !analysis.files) {
    return [];
  }
  
  return analysis.files.map(file => {
    const riskScore = calculateFileRiskScore(file);
    const heatLevel = calculateHeatLevel(riskScore);
    
    return {
      path: file.fileName,
      riskScore,
      heatLevel,
      lines: file.lines,
      language: file.language,
      size: file.size || 0
    };
  }).sort((a, b) => b.riskScore - a.riskScore); // 🔴 高リスク → 🟡 → 🟢 の順
};

// --- 技術的負債集中度計算（未踏で光る機能）---
const calculateTechDebtConcentration = (files: TechDebtFile[]): { concentration: string; percentage: number } => {
  if (files.length === 0) return { concentration: 'LOW', percentage: 0 };
  
  // 上位20%のファイルが全体のリスクの何%を占めるか
  const top20Count = Math.max(1, Math.ceil(files.length * 0.2));
  const top20Files = files.slice(0, top20Count);
  const totalRisk = files.reduce((sum, file) => sum + file.riskScore, 0);
  const top20Risk = top20Files.reduce((sum, file) => sum + file.riskScore, 0);
  const concentration = totalRisk > 0 ? (top20Risk / totalRisk) * 100 : 0;
  
  let level: string;
  if (concentration >= 65) level = 'HIGH';
  else if (concentration >= 45) level = 'MEDIUM';
  else level = 'LOW';
  
  return { concentration: level, percentage: Math.round(concentration) };
};

// --- 技術的負債ヒートマップコンポーネント ---
const TechDebtHeatmap: React.FC<{ analysis: AnalysisResult }> = ({ analysis }) => {
  const techDebtFiles = generateTechDebtData(analysis);
  
  if (techDebtFiles.length === 0) {
    return null;
  }
  
  // 色設計（RiskGaugeと統一）
  const heatColors = {
    low: { bg: '#dcfce7', border: '#22c55e', icon: '🟢', text: '#166534' },
    medium: { bg: '#fef3c7', border: '#eab308', icon: '🟡', text: '#713f12' },
    high: { bg: '#fee2e2', border: '#ef4444', icon: '🔴', text: '#991b1b' }
  };
  
  // 集約サマリー
  const summary = {
    high: techDebtFiles.filter(f => f.heatLevel === 'high').length,
    medium: techDebtFiles.filter(f => f.heatLevel === 'medium').length,
    low: techDebtFiles.filter(f => f.heatLevel === 'low').length
  };
  
  // 技術的負債集中度
  const concentration = calculateTechDebtConcentration(techDebtFiles);
  
  // ファイル選択ハンドラ
  const handleFileClick = (file: TechDebtFile) => {
    // 既存のファイル詳細ビューに遷移するロジック
    const fileElement = document.querySelector(`[data-file-path="${file.path}"]`);
    if (fileElement) {
      fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // ハイライト効果（簡易版）
      (fileElement as HTMLElement).style.backgroundColor = '#fff3cd';
      setTimeout(() => {
        (fileElement as HTMLElement).style.backgroundColor = '';
      }, 2000);
    }
  };
  
  return (
    <div style={{
      backgroundColor: '#fafafa',
      border: '1px solid #d9d9d9',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '24px'
    }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600', color: '#262626' }}>
        🔥 技術的負債ヒートマップ
      </h3>
      
      <div style={{ marginBottom: '20px', fontSize: '14px', color: '#666', lineHeight: '1.4' }}>
        💡 プロジェクト全体の技術的負債分布を可視化。赤いファイルから優先的に改善しましょう。
      </div>
      
      {/* ⚠️ Risk Concentration バナー */}
      <div style={{
        backgroundColor: concentration.concentration === 'HIGH' ? '#fee2e2' : 
                        concentration.concentration === 'MEDIUM' ? '#fef3c7' : '#dcfce7',
        border: `1px solid ${concentration.concentration === 'HIGH' ? '#ef4444' : 
                              concentration.concentration === 'MEDIUM' ? '#eab308' : '#22c55e'}`,
        borderRadius: '8px',
        padding: '12px 16px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#666' }}>
          ⚠️ Risk Concentration: {concentration.concentration}
        </span>
        <span style={{ fontSize: '13px', color: '#666' }}>
          Top 20% files = {concentration.percentage}% of total risk
        </span>
      </div>
      
      {/* 集約サマリー */}
      <div style={{
        backgroundColor: 'white',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#262626' }}>
          📊 技術的負債サマリー
        </h4>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: heatColors.high.border }} />
            <span style={{ fontSize: '13px', color: '#666' }}>High Risk: <strong>{summary.high}</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: heatColors.medium.border }} />
            <span style={{ fontSize: '13px', color: '#666' }}>Medium: <strong>{summary.medium}</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: heatColors.low.border }} />
            <span style={{ fontSize: '13px', color: '#666' }}>Low: <strong>{summary.low}</strong></span>
          </div>
        </div>
        
        {/* 技術的負債集中度（未踏で光る機能） */}
        <div style={{
          backgroundColor: concentration.concentration === 'HIGH' ? '#fee2e2' : 
                          concentration.concentration === 'MEDIUM' ? '#fef3c7' : '#dcfce7',
          border: `1px solid ${concentration.concentration === 'HIGH' ? '#ef4444' : 
                              concentration.concentration === 'MEDIUM' ? '#eab308' : '#22c55e'}`,
          borderRadius: '6px',
          padding: '8px 12px',
          display: 'inline-block'
        }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>
            ⭐ 技術的負債集中度: {concentration.concentration} (上位20%が{concentration.percentage}%のリスクを占める)
          </span>
        </div>
      </div>
      
      {/* ヒートマップグリッド */}
      <div>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          📁 ファイル別リスク分布
        </h4>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '8px',
          maxHeight: '500px',
          overflowY: 'auto'
        }}>
          {techDebtFiles.map((file) => {
            const heatColor = heatColors[file.heatLevel];
            
            return (
              <div
                key={file.path}
                data-file-path={file.path}
                style={{
                  backgroundColor: heatColor.bg,
                  border: `2px solid ${heatColor.border}`,
                  borderRadius: '8px',
                  padding: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  position: 'relative',
                  minHeight: '80px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.02)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                  e.currentTarget.style.zIndex = '10';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.zIndex = '1';
                }}
                onClick={() => handleFileClick(file)}
                title={`${file.path}\nRisk: ${file.riskScore}\nLines: ${file.lines}\nLanguage: ${file.language}`}
              >
                {/* ファイル名とアイコン */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '16px' }}>{heatColor.icon}</span>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: heatColor.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1
                  }}>
                    {file.path.split('/').pop()}
                  </div>
                </div>
                
                {/* リスクスコア */}
                <div style={{
                  fontSize: '11px',
                  color: '#666',
                  marginBottom: '4px'
                }}>
                  Risk: <strong style={{ color: heatColor.text }}>{file.riskScore}</strong>
                </div>
                
                {/* 詳細情報 */}
                <div style={{ fontSize: '10px', color: '#888', lineHeight: '1.2' }}>
                  <div>{file.lines} lines</div>
                  <div>{file.language}</div>
                </div>
                
                {/* ホバー時の詳細ツールチップ */}
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: 'white',
                  border: '1px solid #d9d9d9',
                  borderRadius: '6px',
                  padding: '8px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  zIndex: '100',
                  opacity: '0',
                  pointerEvents: 'none',
                  transition: 'opacity 0.2s',
                  width: '200px',
                  marginBottom: '4px'
                }}
                className="heatmap-tooltip"
              >
                <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '4px', color: '#262626' }}>
                  {file.path}
                </div>
                <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>
                  Risk: {file.riskScore} ({file.heatLevel.toUpperCase()})
                </div>
                <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>
                  Lines: {file.lines}
                </div>
                <div style={{ fontSize: '10px', color: '#666' }}>
                  Language: {file.language}
                </div>
              </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* 凡例 */}
      <div style={{ marginTop: '16px', display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {Object.entries(heatColors).map(([level, color]) => (
          <div key={level} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '16px',
              height: '16px',
              borderRadius: '3px',
              backgroundColor: color.border
            }} />
            <span style={{ fontSize: '12px', color: '#666' }}>
              {level.toUpperCase()} ({level === 'high' ? '70-100' : level === 'medium' ? '40-69' : '0-39'})
            </span>
          </div>
        ))}
      </div>
      
      {/* ツールチップ用スタイル */}
      <style>{`
        .heatmap-tooltip {
          opacity: 0;
          pointer-events: none;
        }
        div:hover .heatmap-tooltip {
          opacity: 1;
        }
      `}</style>
    </div>
  );
};

// --- リファクタ優先度型定義 ---
interface RefactorPriority {
  path: string;
  riskScore: number;
  impactScore: number;
  effortScore: number;
  priorityScore: number;
  rank: number;
  reasons: string[];
  suggestedActions: string[];
}

// --- Impactスコア計算（影響度）---
const calculateImpactScore = (file: FileAnalysis): number => {
  // 正規化関数
  const normalize = (value: number, max: number) => Math.min((value / max) * 100, 100);
  
  // import数（依存関係）
  const importCount = file.structure.imports?.length || 0;
  const normalizedImports = normalize(importCount, 50); // 50 importsを上限
  
  // ファイルサイズ（中核ファイルの可能性）
  const lineCount = file.lines;
  const normalizedLines = normalize(lineCount, 1000); // 1000行を上限
  
  // 関数数（責務の大きさ）
  const functionCount = file.structure.functions?.length || 0;
  const normalizedFunctions = normalize(functionCount, 50); // 50関数を上限
  
  // 重み付け合成
  const impact = 
    0.4 * normalizedImports +    // 依存されている可能性
    0.3 * normalizedLines +     // 中核ファイルの可能性
    0.3 * normalizedFunctions;  // 責務の大きさ
  
  return Math.round(impact);
};

// --- Effortスコア計算（修正コスト）---
const calculateEffortScore = (file: FileAnalysis): number => {
  // 正規化関数
  const normalize = (value: number, max: number) => Math.min((value / max) * 100, 100);
  
  // ネスト深度（理解難易度）
  const nestingDepth = file.blackboxRisk?.breakdown?.nestingDepth || 0;
  const normalizedNesting = normalize(nestingDepth, 8); // 8階層を上限
  
  // ファイル行数（作業量）
  const lineCount = file.lines;
  const normalizedLines = normalize(lineCount, 1000); // 1000行を上限
  
  // AI生成確率（読解困難の可能性）
  const aiLikelihood = file.blackboxRisk?.aiEstimation?.aiLikelihood || 0;
  const normalizedAi = normalize(aiLikelihood, 100); // 100%を上限
  
  // 重み付け合成
  const effort = 
    0.5 * normalizedNesting +   // 理解難易度
    0.3 * normalizedLines +     // 作業量
    0.2 * normalizedAi;        // 読解困難の可能性
  
  return Math.round(effort);
};

// --- リファクタ優先度計算エンジン ---
const calculateRefactorPriority = (file: FileAnalysis): RefactorPriority => {
  // Step 8-1: Risk（既存）
  const riskScore = calculateFileRiskScore(file);
  
  // Step 8-2: Impact（新規）
  const impactScore = calculateImpactScore(file);
  
  // Step 8-3: Effort（修正コスト）
  const effortScore = calculateEffortScore(file);
  
  // Step 8-4: 最終優先度
  // RefactorPriority = Risk × Impact × (1 + Effort * 0.5)
  const priorityScore = Math.round(
    riskScore * (impactScore / 100) * (1 + (effortScore / 100) * 0.5) * 100
  );
  
  // 理由生成
  const reasons: string[] = [];
  if (riskScore >= 70) reasons.push('High risk score');
  if (impactScore >= 70) reasons.push('High impact on codebase');
  if (effortScore >= 70) reasons.push('High effort required');
  if (file.structure.imports && file.structure.imports.length >= 20) reasons.push('High dependency');
  if (file.lines >= 500) reasons.push('Large file');
  if (file.blackboxRisk?.breakdown?.nestingDepth && file.blackboxRisk.breakdown.nestingDepth >= 6) reasons.push('Deep nesting');
  if (file.structure.functions && file.structure.functions.length >= 20) reasons.push('Many functions');
  if (file.blackboxRisk?.aiEstimation?.aiLikelihood && file.blackboxRisk.aiEstimation.aiLikelihood >= 70) reasons.push('AI generated likely');
  
  // アクション提案
  const suggestedActions: string[] = [];
  if (file.blackboxRisk?.breakdown?.nestingDepth && file.blackboxRisk.breakdown.nestingDepth >= 4) {
    suggestedActions.push('Reduce nesting depth');
  }
  if (file.lines >= 300) {
    suggestedActions.push('Split large file');
  }
  if (file.structure.functions && file.structure.functions.length >= 15) {
    suggestedActions.push('Extract helper functions');
  }
  if (file.blackboxRisk?.breakdown?.commentRate !== undefined && file.blackboxRisk.breakdown.commentRate < 0.15) {
    suggestedActions.push('Add documentation');
  }
  if (file.structure.functions && file.structure.functions.length > 5) {
    suggestedActions.push('Remove dead code');
  }
  
  return {
    path: file.fileName,
    riskScore,
    impactScore,
    effortScore,
    priorityScore,
    rank: 0, // 後で設定
    reasons,
    suggestedActions
  };
};

// --- リファクタ優先度ランキング生成 ---
const generateRefactorRanking = (analysis: AnalysisResult): RefactorPriority[] => {
  if (analysis.type !== 'zip' || !analysis.files) {
    return [];
  }
  
  const priorities = analysis.files.map(file => calculateRefactorPriority(file));
  
  // 優先度でソート
  priorities.sort((a, b) => b.priorityScore - a.priorityScore);
  
  // ランク付け
  priorities.forEach((priority, index) => {
    priority.rank = index + 1;
  });
  
  return priorities;
};

// --- リファクタ優先度表示コンポーネント ---
const RefactorPriorityEngine: React.FC<{ analysis: AnalysisResult }> = ({ analysis }) => {
  const ranking = generateRefactorRanking(analysis);
  
  if (ranking.length === 0) {
    return null;
  }
  
  // 上位10件を表示
  const topPriorities = ranking.slice(0, 10);
  
  // 優先度レベルの色分け
  const getPriorityColor = (score: number) => {
    if (score >= 80) return { bg: '#fee2e2', border: '#ef4444', icon: '🔴', text: '#991b1b' };
    if (score >= 60) return { bg: '#fef3c7', border: '#eab308', icon: '🟡', text: '#713f12' };
    if (score >= 40) return { bg: '#dbeafe', border: '#3b82f6', icon: '🔵', text: '#1e3a8a' };
    return { bg: '#dcfce7', border: '#22c55e', icon: '🟢', text: '#166534' };
  };
  
  // ファイルクリックハンドラ
  const handleFileClick = (filePath: string) => {
    const fileElement = document.querySelector(`[data-file-path="${filePath}"]`);
    if (fileElement) {
      fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (fileElement as HTMLElement).style.backgroundColor = '#fff3cd';
      setTimeout(() => {
        (fileElement as HTMLElement).style.backgroundColor = '';
      }, 2000);
    }
  };
  
  return (
    <div style={{
      backgroundColor: '#fafafa',
      border: '1px solid #d9d9d9',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '24px'
    }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600', color: '#262626' }}>
        🔧 リファクタ優先度エンジン
      </h3>
      
      <div style={{ marginBottom: '20px', fontSize: '14px', color: '#666', lineHeight: '1.4' }}>
        💡 Risk（危険度）× Impact（影響度）× Effort（修正コスト）で修正優先度を算出。上位ファイルから改善しましょう。
      </div>
      
      {/* 優先度ランキング */}
      <div style={{
        backgroundColor: 'white',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#262626' }}>
          📊 修正優先度ランキング
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {topPriorities.map((priority) => {
            const color = getPriorityColor(priority.priorityScore);
            
            return (
              <div
                key={priority.path}
                data-file-path={priority.path}
                style={{
                  backgroundColor: color.bg,
                  border: `2px solid ${color.border}`,
                  borderRadius: '8px',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.01)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
                onClick={() => handleFileClick(priority.path)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  {/* ランクとアイコン */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <div style={{
                      fontSize: '18px',
                      fontWeight: 'bold',
                      color: color.text,
                      minWidth: '24px',
                      textAlign: 'center'
                    }}>
                      {priority.rank}
                    </div>
                    <div style={{ fontSize: '20px' }}>{color.icon}</div>
                  </div>
                  
                  {/* ファイル情報 */}
                  <div style={{ flex: 1 }}>
                    <div style={{ 
                      fontSize: '14px', 
                      fontWeight: 'bold', 
                      color: color.text,
                      marginBottom: '6px'
                    }}>
                      {priority.path.split('/').pop()}
                    </div>
                    
                    {/* スコア詳細 */}
                    <div style={{ 
                      fontSize: '12px', 
                      color: '#666', 
                      marginBottom: '8px',
                      display: 'flex',
                      gap: '16px',
                      flexWrap: 'wrap'
                    }}>
                      <span>Priority: <strong style={{ color: color.text }}>{priority.priorityScore}</strong></span>
                      <span>Effort: ~{Math.round(priority.effortScore / 20)}h</span>
                    </div>
                    
                    {/* Whyを1行に圧縮 */}
                    <div style={{ 
                      fontSize: '11px', 
                      color: '#666', 
                      marginBottom: '8px',
                      fontStyle: 'italic'
                    }}>
                      Why: {priority.reasons.slice(0, 1).join('')}
                    </div>
                    
                    {/* 理由表示 */}
                    {priority.reasons.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#666', marginBottom: '4px' }}>
                          Why flagged:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {priority.reasons.map((reason, index) => (
                            <span
                              key={index}
                              style={{
                                backgroundColor: '#f3f4f6',
                                color: '#374151',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                border: '1px solid #d1d5db'
                              }}
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* アクション提案 */}
                    {priority.suggestedActions.length > 0 && (
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#666', marginBottom: '4px' }}>
                          Suggested actions:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {priority.suggestedActions.map((action, index) => (
                            <span
                              key={index}
                              style={{
                                backgroundColor: '#e0f2fe',
                                color: '#0369a1',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                border: '1px solid #7dd3fc'
                              }}
                            >
                              {action}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* 優先度分布サマリー */}
      <div style={{
        backgroundColor: 'white',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '16px'
      }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#262626' }}>
          📈 優先度分布
        </h4>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: '#ef4444' }} />
            <span style={{ fontSize: '12px', color: '#666' }}>
              High (80+): <strong>{ranking.filter(r => r.priorityScore >= 80).length}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: '#eab308' }} />
            <span style={{ fontSize: '12px', color: '#666' }}>
              Medium (60-79): <strong>{ranking.filter(r => r.priorityScore >= 60 && r.priorityScore < 80).length}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: '#3b82f6' }} />
            <span style={{ fontSize: '12px', color: '#666' }}>
              Low (40-59): <strong>{ranking.filter(r => r.priorityScore >= 40 && r.priorityScore < 60).length}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: '#22c55e' }} />
            <span style={{ fontSize: '12px', color: '#666' }}>
              Minimal (&lt;40): <strong>{ranking.filter(r => r.priorityScore < 40).length}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- ブラックボックス指数（BBI）型定義 ---
interface BlackBoxIndex {
  score: number;
  level: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  breakdown: {
    avgRisk: number;
    highRiskRatio: number;
    avgNestingDepth: number;
    lowCommentRatio: number;
    aiSuspiciousRatio: number;
  };
  // 新規：寄与度情報
  contributions: {
    avgRisk: {
      value: number;
      weight: number;
      contribution: number;
      description: string;
    };
    highRiskRatio: {
      value: number;
      weight: number;
      contribution: number;
      description: string;
    };
    avgNestingDepth: {
      value: number;
      weight: number;
      contribution: number;
      description: string;
    };
    lowCommentRatio: {
      value: number;
      weight: number;
      contribution: number;
      description: string;
    };
    aiSuspiciousRatio: {
      value: number;
      weight: number;
      contribution: number;
      description: string;
    };
  };
  interpretation: string[];
}

// --- BBIレベル分類 ---
const getBBILevel = (score: number): { level: string; color: string; icon: string; status: string } => {
  if (score >= 70) return { level: 'CRITICAL', color: '#ef4444', icon: '🔴', status: '⚠️ CRITICAL' };
  if (score >= 40) return { level: 'WARNING', color: '#eab308', icon: '🟡', status: '⚠️ WARNING' };
  return { level: 'HEALTHY', color: '#22c55e', icon: '🟢', status: '✅ HEALTHY' };
};

// --- ブラックボックス指数計算エンジン ---
const calculateBlackBoxIndex = (analysis: AnalysisResult): BlackBoxIndex | null => {
  if (analysis.type !== 'zip' || !analysis.files || analysis.files.length === 0) {
    return null;
  }
  
  const files = analysis.files;
  
  // Step 9-2: 各指標の算出
  
  // ① 平均リスク
  const riskScores = files.map(file => calculateFileRiskScore(file));
  const avgRisk = riskScores.reduce((sum, score) => sum + score, 0) / riskScores.length;
  
  // ② 高リスクファイル率
  const highRiskFiles = files.filter(file => calculateFileRiskScore(file) >= 70);
  const highRiskRatio = highRiskFiles.length / files.length;
  
  // ③ 平均ネスト深度（ファイル平均の平均）
  const nestingDepths = files
    .map(file => file.blackboxRisk?.breakdown?.nestingDepth || 0)
    .filter(depth => depth > 0);
  const avgNestingDepth = nestingDepths.length > 0 
    ? nestingDepths.reduce((sum, depth) => sum + depth, 0) / nestingDepths.length 
    : 0;
  
  // ④ コメント不足率
  const lowCommentFiles = files.filter(file => {
    const commentRate = file.blackboxRisk?.breakdown?.commentRate || 0;
    return commentRate < 0.05; // 5%未満をコメント不足と判定
  });
  const lowCommentRatio = lowCommentFiles.length / files.length;
  
  // ⑤ AI疑い率
  const aiSuspiciousFiles = files.filter(file => {
    const aiLikelihood = file.blackboxRisk?.aiEstimation?.aiLikelihood || 0;
    return aiLikelihood >= 70; // 70%以上をAI疑いと判定
  });
  const aiSuspiciousRatio = aiSuspiciousFiles.length / files.length;
  
  // Step 9-3: 正規化（0-100に揃える）
  const avgRiskNormalized = Math.min(avgRisk, 100);
  const highRiskNormalized = highRiskRatio * 100;
  const avgNestingNormalized = Math.min((avgNestingDepth / 8) * 100, 100); // 8階層を上限
  const lowCommentNormalized = lowCommentRatio * 100;
  const aiSuspiciousNormalized = aiSuspiciousRatio * 100;
  
  // Step 9-4: BBI最終式
  const bbiScore = Math.min(100,
    0.35 * avgRiskNormalized +           // 平均リスク（35%）
    0.25 * highRiskNormalized +          // 高リスクファイル率（25%）
    0.15 * avgNestingNormalized +         // 平均ネスト深度（15%）
    0.15 * lowCommentNormalized +        // コメント不足率（15%）
    0.10 * aiSuspiciousNormalized         // AI疑い率（10%）
  );
  
  // Step 9-6: 解釈テキスト生成
  const interpretation: string[] = [];
  if (highRiskRatio >= 0.3) {
    interpretation.push('High-risk files are concentrated.');
  }
  if (lowCommentRatio >= 0.4) {
    interpretation.push('Documentation is insufficient.');
  }
  if (avgNestingDepth >= 4) {
    interpretation.push('Complex nesting detected.');
  }
  if (avgRisk >= 60) {
    interpretation.push('Overall complexity is high.');
  }
  if (aiSuspiciousRatio >= 0.2) {
    interpretation.push('AI-generated code may require review.');
  }
  if (interpretation.length === 0) {
    interpretation.push('Project appears well-structured.');
  }
  
  // レベル判定
  const { level } = getBBILevel(bbiScore);
  
  return {
    score: Math.round(bbiScore),
    level: level as 'HEALTHY' | 'WARNING' | 'CRITICAL',
    breakdown: {
      avgRisk: Math.round(avgRiskNormalized),
      highRiskRatio: Math.round(highRiskNormalized),
      avgNestingDepth: Math.round(avgNestingNormalized),
      lowCommentRatio: Math.round(lowCommentNormalized),
      aiSuspiciousRatio: Math.round(aiSuspiciousNormalized)
    },
    // 新規：寄与度情報
    contributions: {
      avgRisk: {
        value: Math.round(avgRiskNormalized),
        weight: 35,
        contribution: Math.round(0.35 * avgRiskNormalized),
        description: '平均リスクスコア'
      },
      highRiskRatio: {
        value: Math.round(highRiskNormalized),
        weight: 25,
        contribution: Math.round(0.25 * highRiskNormalized),
        description: '高リスクファイル率'
      },
      avgNestingDepth: {
        value: Math.round(avgNestingNormalized),
        weight: 15,
        contribution: Math.round(0.15 * avgNestingNormalized),
        description: '平均ネスト深度'
      },
      lowCommentRatio: {
        value: Math.round(lowCommentNormalized),
        weight: 15,
        contribution: Math.round(0.15 * lowCommentNormalized),
        description: 'コメント不足率'
      },
      aiSuspiciousRatio: {
        value: Math.round(aiSuspiciousNormalized),
        weight: 10,
        contribution: Math.round(0.10 * aiSuspiciousNormalized),
        description: 'AI生成疑い率'
      }
    },
    interpretation
  };
};

// --- 履歴との連携（削除）---
// getBBIHistoryはUIに統合されているため未使用

// --- ブラックボックス指数表示コンポーネント ---
// --- ブラックボックス指数計算関数（削除）---
// BlackBoxIndexViewはUIに統合されているため、このコンポーネントは未使用

// --- 改善アクション型定義 ---
interface ImprovementAction {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'structure' | 'documentation' | 'performance' | 'maintenance' | 'quality';
  estimatedEffort: 'small' | 'medium' | 'large';
  why?: string; // 教育モード用
  filePath?: string;
  estimatedHours?: number; // 想定工数
  reference?: string; // 参考資料
}

interface ProjectActionPlan {
  critical: ImprovementAction[];
  high: ImprovementAction[];
  medium: ImprovementAction[];
  low: ImprovementAction[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

// --- アクション生成ルールエンジン ---
const generateActionRules = (): Array<{
  condition: (file: FileAnalysis) => boolean;
  actions: Omit<ImprovementAction, 'id' | 'filePath'>[];
}> => {
  return [
    // 深いネスト
    {
      condition: (file) => (file.blackboxRisk?.breakdown?.nestingDepth || 0) >= 5,
      actions: [
        {
          title: '関数分割を検討',
          description: '大きな関数を複数の小さな関数に分割して、可読性と保守性を向上させます',
          priority: 'high',
          category: 'structure',
          estimatedEffort: 'medium',
          why: 'Deep nesting increases cognitive load and makes code harder to understand'
        },
        {
          title: 'early return を使う',
          description: '条件分岐の先にreturn文を配置して、ネストを浅くするリファクタリング手法を適用します',
          priority: 'medium',
          category: 'structure',
          estimatedEffort: 'small',
          why: 'Early returns reduce nesting and improve code readability'
        },
        {
          title: 'ガード節を導入',
          description: '入力値の検証を関数の先頭で行い、異常系を早期に処理するガード節パターンを導入します',
          priority: 'medium',
          category: 'structure',
          estimatedEffort: 'small',
          why: 'Guard clauses make error handling more explicit and reduce nesting'
        }
      ]
    },
    // コメント不足
    {
      condition: (file) => (file.blackboxRisk?.breakdown?.commentRate || 0) < 0.05,
      actions: [
        {
          title: '公開関数に説明追加',
          description: 'エクスポートされている関数にJSDoc形式で目的、引数、戻り値を文書化します',
          priority: 'high',
          category: 'documentation',
          estimatedEffort: 'medium',
          estimatedHours: 2,
          reference: 'https://jsdoc.app/',
          why: 'Documentation helps other developers understand API contracts'
        },
        {
          title: '複雑ロジックにコメント',
          description: 'ビジネスロジックや複雑な処理部分に、なぜそう実装しているかを説明するコメントを追加します',
          priority: 'medium',
          category: 'documentation',
          estimatedEffort: 'medium',
          estimatedHours: 1.5,
          reference: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Comments',
          why: 'Comments explain the intent behind complex business logic'
        },
        {
          title: 'README補足',
          description: 'プロジェクトのREADMEに、このファイルの役割と使用方法を追記します',
          priority: 'low',
          category: 'documentation',
          estimatedEffort: 'small',
          estimatedHours: 0.5,
          reference: 'https://www.makeareadme.com/',
          why: 'Good documentation improves project maintainability'
        }
      ]
    },
    // 巨大ファイル
    {
      condition: (file) => file.lines >= 800,
      actions: [
        {
          title: 'ファイル分割',
          description: '関連する機能を別のファイルに分離し、単一責任の原則に従ってファイルを整理します',
          priority: 'critical',
          category: 'structure',
          estimatedEffort: 'large',
          why: 'Large files are harder to maintain and understand'
        },
        {
          title: '責務分離',
          description: 'ファイル内の異なる責務を持つコードを、それぞれ専用のモジュールに分割します',
          priority: 'high',
          category: 'structure',
          estimatedEffort: 'large',
          why: 'Single responsibility principle improves code organization'
        },
        {
          title: 'モジュール化',
          description: '関連する関数をクラスやモジュールにまとめて、コードの構造を改善します',
          priority: 'medium',
          category: 'structure',
          estimatedEffort: 'medium',
          why: 'Modularization improves code reusability and testability'
        }
      ]
    },
    // 未使用関数あり
    {
      condition: (file) => file.structure.functions && file.structure.functions.length > 5,
      actions: [
        {
          title: '未使用関数削除',
          description: '本当に使用されていない関数を安全に削除して、コードベースを整理します',
          priority: 'medium',
          category: 'maintenance',
          estimatedEffort: 'small',
          why: 'Dead code increases maintenance burden and confusion'
        },
        {
          title: 'tree-shaking確認',
          description: 'ビルドツールのtree-shakingが正しく機能しているか確認し、未使用コードを削除します',
          priority: 'low',
          category: 'performance',
          estimatedEffort: 'small',
          why: 'Tree shaking reduces bundle size and improves performance'
        },
        {
          title: 'export見直し',
          description: '本当に公開する必要がある関数のみをexportするように見直します',
          priority: 'low',
          category: 'maintenance',
          estimatedEffort: 'small',
          why: 'Unnecessary exports increase API surface area'
        }
      ]
    },
    // AI生成疑い高
    {
      condition: (file) => (file.blackboxRisk?.aiEstimation?.aiLikelihood || 0) >= 70,
      actions: [
        {
          title: '手動レビュー推奨',
          description: 'AI生成コードは品質にばらつきがあるため、人間による詳細なレビューが必要です',
          priority: 'high',
          category: 'quality',
          estimatedEffort: 'medium',
          why: 'AI-generated code may contain subtle bugs or security issues'
        },
        {
          title: 'エッジケース確認',
          description: 'AI生成コードは一般的なケースに最適化されがちなので、エッジケースの動作を確認します',
          priority: 'medium',
          category: 'quality',
          estimatedEffort: 'medium',
          why: 'Edge cases are often overlooked in AI-generated code'
        },
        {
          title: 'テスト追加',
          description: 'AI生成コードの動作を保証するため、包括的なテストを追加します',
          priority: 'high',
          category: 'quality',
          estimatedEffort: 'large',
          why: 'Tests ensure AI-generated code works correctly in all scenarios'
        }
      ]
    },
    // 中程度のリスク（汎用）
    {
      condition: (file) => {
        const riskScore = calculateFileRiskScore(file);
        return riskScore >= 40 && riskScore < 70;
      },
      actions: [
        {
          title: 'コードスタイル統一',
          description: 'プロジェクトのコーディング規約に合わせて、コードスタイルを統一します',
          priority: 'low',
          category: 'maintenance',
          estimatedEffort: 'small',
          why: 'Consistent code style improves readability'
        },
        {
          title: '変数名改善',
          description: '意味のある変数名を使用して、コードの自己文書化性を向上させます',
          priority: 'low',
          category: 'documentation',
          estimatedEffort: 'small',
          why: 'Good variable names reduce the need for comments'
        }
      ]
    }
  ];
};

// --- ファイル別アクション生成 ---
const generateFileActions = (file: FileAnalysis): ImprovementAction[] => {
  const rules = generateActionRules();
  const actions: ImprovementAction[] = [];
  
  rules.forEach((rule, ruleIndex) => {
    if (rule.condition(file)) {
      rule.actions.forEach((action, actionIndex) => {
        actions.push({
          ...action,
          id: `${file.fileName}_${ruleIndex}_${actionIndex}`,
          filePath: file.fileName
        });
      });
    }
  });
  
  // 優先度でソート
  const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
  return actions.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
};

// --- プロジェクト全体アクションプラン生成 ---
const generateProjectActionPlan = (analysis: AnalysisResult): ProjectActionPlan => {
  if (analysis.type !== 'zip' || !analysis.files) {
    return {
      critical: [],
      high: [],
      medium: [],
      low: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 }
    };
  }
  
  const allActions: ImprovementAction[] = [];
  
  analysis.files.forEach(file => {
    const fileActions = generateFileActions(file);
    allActions.push(...fileActions);
  });
  
  // 優先度で分類
  const plan: ProjectActionPlan = {
    critical: allActions.filter(a => a.priority === 'critical'),
    high: allActions.filter(a => a.priority === 'high'),
    medium: allActions.filter(a => a.priority === 'medium'),
    low: allActions.filter(a => a.priority === 'low'),
    summary: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    }
  };
  
  // サマリー更新
  plan.summary.critical = plan.critical.length;
  plan.summary.high = plan.high.length;
  plan.summary.medium = plan.medium.length;
  plan.summary.low = plan.low.length;
  
  return plan;
};

// --- レポート出力機能 ---
const generateActionReport = (plan: ProjectActionPlan): string => {
  let report = '# Recommended Refactors\n\n';
  
  // Critical actions
  if (plan.critical.length > 0) {
    report += '## 🔥 Critical Actions\n\n';
    plan.critical.forEach((action, index) => {
      report += `${index + 1}. **${action.title}** (${action.filePath})\n`;
      report += `   - ${action.description}\n`;
      if (action.why) report += `   - *Why: ${action.why}*\n`;
      report += '\n';
    });
  }
  
  // High priority actions
  if (plan.high.length > 0) {
    report += '## ⚠️ High Priority Actions\n\n';
    plan.high.slice(0, 5).forEach((action, index) => {
      report += `${index + 1}. **${action.title}** (${action.filePath})\n`;
      report += `   - ${action.description}\n`;
      if (action.why) report += `   - *Why: ${action.why}*\n`;
      report += '\n';
    });
    
    if (plan.high.length > 5) {
      report += `... and ${plan.high.length - 5} more high priority actions\n\n`;
    }
  }
  
  // Summary
  report += '## Summary\n\n';
  report += `- Critical: ${plan.summary.critical}\n`;
  report += `- High: ${plan.summary.high}\n`;
  report += `- Medium: ${plan.summary.medium}\n`;
  report += `- Low: ${plan.summary.low}\n`;
  report += `\n**Total: ${plan.summary.critical + plan.summary.high + plan.summary.medium + plan.summary.low} actions**\n`;
  
  return report;
};

// --- 改善アクション表示コンポーネント ---
const ImprovementActionEngine: React.FC<{ analysis: AnalysisResult }> = ({ analysis }) => {
  const actionPlan = generateProjectActionPlan(analysis);
  
  const totalActions = actionPlan.summary.critical + actionPlan.summary.high + actionPlan.summary.medium + actionPlan.summary.low;
  
  if (totalActions === 0) {
    return null;
  }
  
  // 優先度の色とアイコン
  const priorityConfig = {
    critical: { color: '#ef4444', bgColor: '#fee2e2', icon: '🔥', label: 'Critical' },
    high: { color: '#f97316', bgColor: '#fed7aa', icon: '⚠️', label: 'High' },
    medium: { color: '#eab308', bgColor: '#fef3c7', icon: '💡', label: 'Medium' },
    low: { color: '#22c55e', bgColor: '#dcfce7', icon: '✅', label: 'Low' }
  };
  
  return (
    <div style={{
      backgroundColor: '#fafafa',
      border: '1px solid #d9d9d9',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '24px'
    }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: '600', color: '#262626' }}>
        🛠️ 改善アクション自動生成
      </h3>
      
      <div style={{ marginBottom: '20px', fontSize: '14px', color: '#666', lineHeight: '1.4' }}>
        💡 解析結果から具体的な改善アクションを自動生成。優先度の高いものから着手しましょう。
      </div>
      
      {/* 全体アクションサマリー */}
      <div style={{
        backgroundColor: 'white',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h4 style={{ margin: 0, color: '#1f2937', fontSize: '14px', fontWeight: '600' }}>
            Recommended Improvements
          </h4>
        </div>
        
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {Object.entries(priorityConfig).map(([priority, config]) => {
            const count = actionPlan.summary[priority as keyof typeof actionPlan.summary];
            if (count === 0) return null;
            
            return (
              <div
                key={priority}
                style={{
                  backgroundColor: config.bgColor,
                  border: `1px solid ${config.color}`,
                  borderRadius: '6px',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span style={{ fontSize: '16px' }}>{config.icon}</span>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: config.color }}>
                  {config.label} ({count})
                </span>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Critical Actions */}
      {actionPlan.critical.length > 0 && (
        <div style={{
          backgroundColor: 'white',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '16px'
        }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#ef4444' }}>
            🔥 Critical Actions
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {actionPlan.critical.slice(0, 3).map((action, index) => (
              <div
                key={action.id}
                style={{
                  backgroundColor: '#fee2e2',
                  border: '1px solid #ef4444',
                  borderRadius: '6px',
                  padding: '12px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#991b1b' }}>
                    {index + 1}. {action.title}
                  </div>
                  <div style={{ fontSize: '11px', color: '#666', backgroundColor: '#fef2f2', padding: '2px 6px', borderRadius: '4px' }}>
                    {action.filePath}
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>
                  {action.description}
                </div>
                {action.why && (
                  <div style={{ fontSize: '11px', color: '#7f1d1d', fontStyle: 'italic' }}>
                    Why: {action.why}
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {actionPlan.critical.length > 3 && (
            <div style={{ fontSize: '12px', color: '#666', textAlign: 'center', marginTop: '8px' }}>
              ... and {actionPlan.critical.length - 3} more critical actions
            </div>
          )}
        </div>
      )}
      
      {/* High Priority Actions */}
      {actionPlan.high.length > 0 && (
        <div style={{
          backgroundColor: 'white',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '16px'
        }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#f97316' }}>
            ⚠️ High Priority Actions
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {actionPlan.high.slice(0, 5).map((action, index) => (
              <div
                key={action.id}
                style={{
                  backgroundColor: '#fed7aa',
                  border: '1px solid #f97316',
                  borderRadius: '6px',
                  padding: '10px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#9a3412' }}>
                    {index + 1}. {action.title}
                  </div>
                  <div style={{ fontSize: '10px', color: '#666', backgroundColor: '#fff7ed', padding: '1px 4px', borderRadius: '3px' }}>
                    {action.filePath}
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: '#666' }}>
                  {action.description}
                </div>
              </div>
            ))}
          </div>
          
          {actionPlan.high.length > 5 && (
            <div style={{ fontSize: '12px', color: '#666', textAlign: 'center', marginTop: '8px' }}>
              ... and {actionPlan.high.length - 5} more high priority actions
            </div>
          )}
        </div>
      )}
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
        <h4>🤖 AI Generated Likelihood: {risk.aiEstimation?.aiLikelihood || 0}%</h4>
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
            {risk.unusedFunctions.count > 0 && (
              <div className="unused-functions-list">
                {/* 未使用関数のリストは省略（型エラー回避のため） */}
                <span className="unused-function-item">{risk.unusedFunctions.count}個の未使用関数を検出</span>
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
  const [expandedSections, setExpandedSections] = useState({
    level1: true,
    level2: true,
    level3: false
  });
  const [fileContent, setFileContent] = useState<string>('');

  // --- UI状態管理 ---
  const toggleSection = (level: 'level1' | 'level2' | 'level3') => {
    setExpandedSections(prev => ({
      ...prev,
      [level]: !prev[level]
    }));
  };

  // --- 次の最適アクション計算（強化版）---
  interface NextBestAction {
    action: string;
    file: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    effort: 'SMALL' | 'MEDIUM' | 'LARGE';
    category: string;
    targetElement?: string;
    // 新規：根拠と実行導線
    rationale: {
      why: string;           // なぜ最優先か
      evidence: string[];    // 根拠データ
      confidence: number;     // 信頼度 0-100
      estimatedHours: number; // 想定工数
    };
    nextSteps: {
      immediate: string;     // 即時アクション
      followUp: string;      // 次のステップ
      resources: string[];   // 参考リソース
    };
  }

  const getNextBestAction = (analysis: AnalysisResult): NextBestAction | null => {
    if (!analysis || analysis.type !== 'zip' || !analysis.files) {
      return null;
    }
    
    // プロジェクト健全性チェック
    const health = calculateProjectHealthScore(analysis);
    const bbi = calculateBlackBoxIndex(analysis);
    
    // ケース①：問題なし
    if (health && health.score >= 80 && bbi && bbi.score < 40) {
      return {
        action: 'No critical issues detected',
        file: 'Project',
        impact: 'LOW',
        effort: 'SMALL',
        category: 'health',
        rationale: {
          why: 'プロジェクトの健全性が高く、緊急の対応は不要',
          evidence: [`健全性スコア: ${health.score}/100`, `BBI: ${bbi.score}/100`],
          confidence: 95,
          estimatedHours: 0
        },
        nextSteps: {
          immediate: '現状維持',
          followUp: '定期的なモニタリングを推奨',
          resources: []
        }
      };
    }
    
    // アクションプランと優先度を取得
    const actionPlan = generateProjectActionPlan(analysis);
    const priorities = generateRefactorRanking(analysis);
    
    // Critical priority の最上位
    if (actionPlan.critical.length > 0) {
      const topCritical = actionPlan.critical[0];
      return {
        action: generateActionText(topCritical),
        file: topCritical.filePath || 'Unknown',
        impact: 'HIGH',
        effort: topCritical.estimatedEffort.toUpperCase() as 'SMALL' | 'MEDIUM' | 'LARGE',
        category: topCritical.category,
        targetElement: topCritical.filePath,
        rationale: {
          why: 'クリティカルな問題が検出され、即時対応が必要',
          evidence: [topCritical.description, `カテゴリ: ${topCritical.category}`],
          confidence: 100,
          estimatedHours: topCritical.estimatedHours || 4
        },
        nextSteps: {
          immediate: 'クリティカル問題の修正を開始',
          followUp: '修正後のテストとレビューを実施',
          resources: topCritical.reference ? [topCritical.reference] : []
        }
      };
    }
    
    // High priority の最上位
    if (actionPlan.high.length > 0) {
      const topHigh = actionPlan.high[0];
      return {
        action: generateActionText(topHigh),
        file: topHigh.filePath || 'Unknown',
        impact: 'HIGH',
        effort: topHigh.estimatedEffort.toUpperCase() as 'SMALL' | 'MEDIUM' | 'LARGE',
        category: topHigh.category,
        targetElement: topHigh.filePath,
        rationale: {
          why: '高優先度の問題が検出され、早期対応を推奨',
          evidence: [topHigh.description, `カテゴリ: ${topHigh.category}`],
          confidence: 85,
          estimatedHours: topHigh.estimatedHours || 2
        },
        nextSteps: {
          immediate: '高優先度問題の修正を計画',
          followUp: '修正後の影響範囲を確認',
          resources: topHigh.reference ? [topHigh.reference] : []
        }
      };
    }
    
    // Medium priority の最上位
    if (actionPlan.medium.length > 0) {
      const topMedium = actionPlan.medium[0];
      return {
        action: generateActionText(topMedium),
        file: topMedium.filePath || 'Unknown',
        impact: 'MEDIUM',
        effort: topMedium.estimatedEffort.toUpperCase() as 'SMALL' | 'MEDIUM' | 'LARGE',
        category: topMedium.category,
        targetElement: topMedium.filePath,
        rationale: {
          why: '中優先度の改善項目が検出され、余裕がある際に対応',
          evidence: [topMedium.description, `カテゴリ: ${topMedium.category}`],
          confidence: 70,
          estimatedHours: topMedium.estimatedHours || 1
        },
        nextSteps: {
          immediate: '改善項目のリストアップ',
          followUp: '次のスプリントで計画に組み込み',
          resources: topMedium.reference ? [topMedium.reference] : []
        }
      };
    }
    
    // 優先度ランキングからフォールバック
    if (priorities.length > 0) {
      const topPriority = priorities[0];
      return {
        action: 'Reduce complexity',
        file: topPriority.path,
        impact: topPriority.priorityScore >= 80 ? 'HIGH' : topPriority.priorityScore >= 60 ? 'MEDIUM' : 'LOW',
        effort: 'MEDIUM',
        category: 'structure',
        targetElement: topPriority.path,
        rationale: {
          why: 'コード複雑度を削減することで、保守性と可読性が向上',
          evidence: [`優先度スコア: ${topPriority.priorityScore}/100`, `ファイル: ${topPriority.path}`],
          confidence: 60,
          estimatedHours: 3
        },
        nextSteps: {
          immediate: '複雑度の高い箇所を特定',
          followUp: 'リファクタリングを実施',
          resources: []
        }
      };
    }
    
    return null;
  };

  // --- Next Best Action ウィジェットコンポーネント ---
const NextBestActionWidget: React.FC<{ analysis: AnalysisResult }> = ({ analysis }) => {
  const nextAction = getNextBestAction(analysis);
  
  if (!nextAction) {
    return (
      <div style={{
        backgroundColor: '#f3f4f6',
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        padding: '12px 16px',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#6b7280' }}>
          👉 Next Best Action:
        </span>
        <span style={{ fontSize: '13px', color: '#6b7280' }}>
          — No actions available —
        </span>
      </div>
    );
  }
  
  // Impact バッジの色
  const impactColors = {
    HIGH: { bg: '#fee2e2', color: '#991b1b', border: '#ef4444' },
    MEDIUM: { bg: '#fef3c7', color: '#713f12', border: '#eab308' },
    LOW: { bg: '#dcfce7', color: '#166534', border: '#22c55e' }
  };
  
  const impactColor = impactColors[nextAction.impact];
  
  // View Details クリックハンドラ
  const handleViewDetails = () => {
    if (nextAction.targetElement) {
      // 対象ファイルの詳細へスクロール
      const fileElement = document.querySelector(`[data-file-path="${nextAction.targetElement}"]`);
      if (fileElement) {
        fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // ハイライト効果
        (fileElement as HTMLElement).style.backgroundColor = '#fff3cd';
        setTimeout(() => {
          (fileElement as HTMLElement).style.backgroundColor = '';
        }, 2000);
      }
    }
  };
  
  return (
    <div style={{
      backgroundColor: '#e0f2fe',
      border: '1px solid #0ea5e9',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '16px',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
    }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#0c4a6e' }}>
          👉 Next Best Action:
        </span>
        <span style={{
          backgroundColor: impactColor.bg,
          color: impactColor.color,
          border: `1px solid ${impactColor.border}`,
          padding: '2px 6px',
          borderRadius: '8px',
          fontSize: '10px',
          fontWeight: 'bold'
        }}>
          {nextAction.impact}
        </span>
        <span style={{
          backgroundColor: '#f1f5f9',
          color: '#475569',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '10px'
        }}>
          {nextAction.effort}
        </span>
        <span style={{
          backgroundColor: nextAction.rationale.confidence >= 80 ? '#dcfce7' : 
                         nextAction.rationale.confidence >= 60 ? '#fef3c7' : '#fee2e2',
          color: nextAction.rationale.confidence >= 80 ? '#166534' : 
                nextAction.rationale.confidence >= 60 ? '#713f12' : '#991b1b',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '10px'
        }}>
          信頼度: {nextAction.rationale.confidence}%
        </span>
        {nextAction.rationale.estimatedHours > 0 && (
          <span style={{
            backgroundColor: '#f3f4f6',
            color: '#374151',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '10px'
          }}>
            ⏱️ {nextAction.rationale.estimatedHours}h
          </span>
        )}
      </div>

      {/* アクション内容 */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '15px', color: '#075985', fontWeight: '600', marginBottom: '4px' }}>
          {nextAction.action}
        </div>
        {nextAction.file !== 'Project' && (
          <div style={{ fontSize: '12px', color: '#0284c7', backgroundColor: '#f0f9ff', padding: '2px 6px', borderRadius: '4px', display: 'inline-block' }}>
            📁 {nextAction.file.split('/').pop()}
          </div>
        )}
      </div>

      {/* 根拠説明 */}
      <div style={{
        backgroundColor: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '6px',
        padding: '10px',
        marginBottom: '12px'
      }}>
        <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>
          🎯 なぜこれが最優先か：
        </div>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>
          {nextAction.rationale.why}
        </div>
        <div style={{ fontSize: '10px', color: '#94a3b8' }}>
          根拠: {nextAction.rationale.evidence.join(', ')}
        </div>
      </div>

      {/* 実行導線 */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {nextAction.targetElement && (
          <button
            onClick={handleViewDetails}
            style={{
              backgroundColor: '#0ea5e9',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '11px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#0284c7'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#0ea5e9'}
          >
            📍 ファイルを確認
          </button>
        )}
        
        <div style={{ fontSize: '10px', color: '#64748b' }}>
          💡 {nextAction.nextSteps.immediate}
        </div>
        
        {nextAction.nextSteps.resources.length > 0 && (
          <div style={{ fontSize: '10px', color: '#0ea5e9', cursor: 'pointer' }}>
            📚 参考資料 ({nextAction.nextSteps.resources.length})
          </div>
        )}
      </div>
    </div>
  );
};

  const generateActionText = (action: ImprovementAction): string => {
    const actionMap: { [key: string]: string } = {
      '関数分割を検討': 'Split large functions',
      'early return を使う': 'Use early returns',
      'ガード節を導入': 'Add guard clauses',
      '公開関数に説明追加': 'Document public functions',
      '複雑ロジックにコメント': 'Add comments to complex logic',
      'README補足': 'Update documentation',
      'ファイル分割': 'Split large file',
      '責務分離': 'Separate responsibilities',
      'モジュール化': 'Modularize code',
      '未使用関数削除': 'Remove unused functions',
      'tree-shaking確認': 'Check tree shaking',
      'export見直し': 'Review exports',
      '手動レビュー推奨': 'Review AI-generated code',
      'エッジケース確認': 'Check edge cases',
      'テスト追加': 'Add comprehensive tests',
      'コードスタイル統一': 'Standardize code style',
      '変数名改善': 'Improve variable names'
    };
    
    return actionMap[action.title] || action.title;
  };

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
      aiEstimation: {
                  aiLikelihood: 0, 
                  confidence: 0,
                  reasons: [],
                  commentRate: 0,
                  avgFunctionLength: 0,
                  complexityScore: 0,
                  namingConsistency: 0,
                  importPattern: '',
                  errorHandling: 0
                }
    };
  };

  const extractZipFile = async (file: File): Promise<{ path: string; content: string }[]> => {
    try {
      const zip = new JSZip();
      const data = await file.arrayBuffer();
      const contents = await zip.loadAsync(data);
      const files: { path: string; content: string }[] = [];

      for (const [path, fileData] of Object.entries(contents.files)) {
        if ((fileData as any).dir) continue;
        
        // Windowsパスの正規化
        const normalizedPath = path.replace(/\\/g, "/").replace(/^\.\//, "");
        
        // 除外ディレクトリ
        if (['node_modules/', '.git/', 'dist/', 'build/'].some(p => normalizedPath.includes(p))) continue;
        
        // サポート対象ファイル
        if (isSupportedFile(normalizedPath)) {
          try {
            const content = await (fileData as any).async('string');
            files.push({ path: normalizedPath, content });
          } catch (contentError) {
            console.warn(`Failed to read file ${normalizedPath}:`, contentError);
            // エラーがあっても処理を続行
            continue;
          }
        }
      }
      
      return files;
    } catch (error) {
      console.error('ZIP extraction error:', error);
      throw new Error(`ZIPファイルの解析に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };

  const analyzeFile = async () => {
    if (!selectedFile) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      if (selectedFile.name.toLowerCase().endsWith('.zip')) {
        const extracted = await extractZipFile(selectedFile);
        
        if (extracted.length === 0) {
          throw new Error('解析可能なファイルが見つかりませんでした。サポート対象のファイルが含まれているか確認してください。');
        }
        
        const fileMap = extracted.reduce((m, f) => ({ ...m, [f.path]: f.content }), {} as Record<string, string>);

        const analyzed = extracted.map(f => {
          try {
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
          } catch (fileError) {
            console.warn(`Failed to analyze file ${f.path}:`, fileError);
            // エラーがあっても基本情報は返す
            return {
              fileName: f.path, language: 'unknown', technologies: [],
              size: f.content.length, lines: f.content.split('\n').length,
              structure: { functions: [], classes: [], imports: [], exports: [] },
              dependencies: [], resolvedDependencies: [],
              blackboxRisk: { 
                score: 0, 
                level: 'LOW' as const, 
                breakdown: { fileSize: 0, functionLength: 0, nestingDepth: 0, commentRate: 0, unusedCode: 0, typeSafety: 0 }, 
                nestingDepth: { maxDepth: 0, avgDepth: 0, riskScore: 0 }, 
                commentRatio: { commentRatio: 0, riskScore: 0, commentLines: 0, totalLines: 0 }, 
                fileSize: { lineCount: 0, riskScore: 0 }, 
                unusedFunctions: { count: 0, riskScore: 0 }, 
                aiEstimation: {
                  aiLikelihood: 0, 
                  confidence: 0,
                  reasons: []
                } 
              }
            };
          }
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
      console.error('Analysis error:', err);
      const errorMessage = err instanceof Error ? err.message : '不明なエラーが発生しました';
      setError(errorMessage);
      
      // ユーザーフレンドリーなエラーメッセージ
      if (errorMessage.includes('ZIP') || errorMessage.includes('解析')) {
        setError(`${errorMessage}\n\n💡 対策:\n- サポート対象のファイル（.js, .ts, .jsx, .tsx, .py, .javaなど）が含まれているか確認\n- ZIPファイルが破損していないか確認\n- ファイルサイズが大きすぎないか確認（最大50MB推奨）`);
      }
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
            {/* 🚨 Next Best Action - 最上部固定 */}
            <div style={{
              position: 'sticky',
              top: '0',
              zIndex: 100,
              backgroundColor: '#fff',
              borderBottom: '3px solid #ef4444',
              marginBottom: '24px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
            }}>
              <NextBestActionWidget analysis={analysisResult} />
            </div>

            {/* Level 1: プロジェクト概要（3秒サマリー） */}
            <div style={{ marginBottom: '12px' }}>
              <div 
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '6px',
                  backgroundColor: expandedSections.level1 ? '#f3f4f6' : 'transparent'
                }}
                onClick={() => toggleSection('level1')}
              >
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#262626' }}>
                  📊 プロジェクト概要
                </h3>
                <span style={{ fontSize: '14px', color: '#666' }}>
                  {expandedSections.level1 ? '▼' : '▶'}
                </span>
              </div>
              
              {expandedSections.level1 && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                  padding: '12px',
                  backgroundColor: '#fafafa',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px'
                }}>
                  {/* BBIカード */}
                  {(() => {
                    const bbi = calculateBlackBoxIndex(analysisResult);
                    if (!bbi) return null;
                    const { level, color } = getBBILevel(bbi.score);
                    return (
                      <div style={{
                        backgroundColor: 'white',
                        border: `1px solid ${color}`,
                        borderRadius: '6px',
                        padding: '10px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        position: 'relative'
                      }}
                      onClick={() => {
                        alert(`ブラックボックス指数 詳細情報:\n\nスコア: ${bbi.score}\nレベル: ${level}\n\n解釈:\n${bbi.interpretation.join('\n')}\n\n推奨アクション:\n${level === 'CRITICAL' ? '即時対応が必要です' : level === 'WARNING' ? '監視と改善が必要です' : '現状維持で問題ありません'}`);
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px', fontWeight: '500' }}>ブラックボックス指数</div>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color, marginBottom: '4px' }}>
                        {bbi.score}
                      </div>
                      <div style={{ fontSize: '10px', color, fontWeight: 'bold', marginBottom: '4px' }}>
                        {level === 'CRITICAL' ? '🔴 要対応' : level === 'WARNING' ? '⚠️ 要注意' : '✅ 健全'}
                      </div>
                      <div style={{ fontSize: '9px', color: '#666', lineHeight: '1.2' }}>
                        {bbi.interpretation[0] || '主な問題: 高リスクファイル集中'}
                      </div>
                      <div style={{ 
                        position: 'absolute', 
                        top: '4px', 
                        right: '4px', 
                        fontSize: '10px', 
                        color: '#999',
                        opacity: 0.7
                      }}>
                        🔍
                      </div>
                    </div>
                    );
                  })()}
                  
                  {/* Health Scoreカード */}
                  {(() => {
                    const health = calculateProjectHealthScore(analysisResult);
                    if (!health) return null;
                    const { level, color } = getHealthLevel(health.score);
                    return (
                      <div style={{
                        backgroundColor: 'white',
                        border: `1px solid ${color}`,
                        borderRadius: '6px',
                        padding: '10px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        position: 'relative'
                      }}
                      onClick={() => {
                        const weakPoint = health.breakdown.avgCommentRatio < 50 ? 'ドキュメント' : health.breakdown.avgRiskScore > 70 ? 'リスクスコア' : 'コード品質';
                        alert(`健全性スコア 詳細情報:\n\nスコア: ${health.score}\nレベル: ${level}\n\n内訳:\n• コメント率: ${health.breakdown.avgCommentRatio.toFixed(1)}%\n• 平均リスクスコア: ${health.breakdown.avgRiskScore.toFixed(1)}\n• 高リスクファイル率: ${(health.breakdown.highRiskFileRatio * 100).toFixed(1)}%\n• 平均ネスト深度: ${health.breakdown.avgNestingDepth.toFixed(1)}\n• AI生成率: ${(health.breakdown.avgAiLikelihood * 100).toFixed(1)}%\n\n弱点: ${weakPoint}\n\n推奨アクション:\n${level === 'POOR' ? '全体的な改善が必要です' : level === 'FAIR' ? '部分的な改善を推奨します' : level === 'GOOD' ? '維持と微改善を推奨します' : '現状を維持してください'}`);
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                        <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px', fontWeight: '500' }}>健全性スコア</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color, marginBottom: '4px' }}>
                          {health.score}
                        </div>
                        <div style={{ fontSize: '10px', color: color, fontWeight: 'bold', marginBottom: '4px' }}>
                          {level === 'POOR' ? '🔴 要改善' : level === 'FAIR' ? '🟡 普通' : level === 'GOOD' ? '🟢 良好' : '✅ 優秀'}
                        </div>
                        <div style={{ fontSize: '9px', color: '#666', lineHeight: '1.2' }}>
                          弱点: {health.breakdown.avgCommentRatio < 50 ? 'ドキュメント' : health.breakdown.avgRiskScore > 70 ? 'リスクスコア' : 'コード品質'}
                        </div>
                        <div style={{ 
                          position: 'absolute', 
                          top: '4px', 
                          right: '4px', 
                          fontSize: '10px', 
                          color: '#999',
                          opacity: 0.7
                        }}>
                          🔍
                        </div>
                      </div>
                    );
                  })()}
                  
                  {/* High Risk Filesカード */}
                  {(() => {
                    if (analysisResult.type !== 'zip' || !analysisResult.files) return null;
                    const highRiskCount = analysisResult.files.filter(f => calculateFileRiskScore(f) >= 70).length;
                    const topRiskFile = analysisResult.files
                      .filter(f => calculateFileRiskScore(f) >= 70)
                      .sort((a, b) => calculateFileRiskScore(b) - calculateFileRiskScore(a))[0];
                    return (
                      <div style={{
                        backgroundColor: 'white',
                        border: '1px solid #ef4444',
                        borderRadius: '6px',
                        padding: '10px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        position: 'relative'
                      }}
                      onClick={() => {
                        if (!analysisResult.files) return;
                        const highRiskFiles = analysisResult.files.filter(f => calculateFileRiskScore(f) >= 70);
                        const top3Files = highRiskFiles.slice(0, 3);
                        const fileList = top3Files.map((file, index) => {
                          const score = calculateFileRiskScore(file);
                          return `${index + 1}. ${file.fileName.split('/').pop()} (スコア: ${score.toFixed(1)})`;
                        }).join('\n');
                        
                        alert(`高リスクファイル 詳細情報:\n\nハイリスクファイル数: ${highRiskCount}件\n\nトップ3ハイリスクファイル:\n${fileList}${highRiskFiles.length > 3 ? `\n... 他${highRiskFiles.length - 3}件` : ''}\n\n推奨アクション:\n• 優先的にハイリスクファイルを確認してください\n• AI生成コードの場合は特に注意が必要です\n• 手動レビューとテストの追加を推奨します`);
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                        <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px', fontWeight: '500' }}>高リスクファイル</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ef4444', marginBottom: '4px' }}>
                          {highRiskCount}
                        </div>
                        <div style={{ fontSize: '10px', color: '#ef4444', fontWeight: 'bold', marginBottom: '4px' }}>
                          🔴 要対応
                        </div>
                        <div style={{ fontSize: '9px', color: '#666', lineHeight: '1.2' }}>
                          上位: {topRiskFile?.fileName.split('/').pop() || '不明'}
                        </div>
                        <div style={{ 
                          position: 'absolute', 
                          top: '4px', 
                          right: '4px', 
                          fontSize: '10px', 
                          color: '#999',
                          opacity: 0.7
                        }}>
                          🔍
                        </div>
                      </div>
                    );
                  })()}
                  
                  {/* Critical Actionsカード */}
                  {(() => {
                    const actionPlan = generateProjectActionPlan(analysisResult);
                    const totalHours = actionPlan.critical.length * 2 + actionPlan.high.length * 1.5;
                    return (
                      <div style={{
                        backgroundColor: 'white',
                        border: '1px solid #f97316',
                        borderRadius: '6px',
                        padding: '10px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        position: 'relative'
                      }}
                      onClick={() => {
                        const criticalActions = actionPlan.critical.slice(0, 3);
                        const highActions = actionPlan.high.slice(0, 2);
                        const actionList = criticalActions.map((action, index) => {
                          return `C${index + 1}. ${action.title} (${action.filePath})`;
                        }).concat(highActions.map((action, index) => {
                          return `H${index + 1}. ${action.title} (${action.filePath})`;
                        })).join('\n');
                        
                        alert(`重要アクション 詳細情報:\n\nクリティカルアクション数: ${actionPlan.summary.critical}件\nハイプライオリティ数: ${actionPlan.summary.high}件\n\n優先アクション:\n${actionList}\n\n推定工数: 約${Math.round(totalHours)}時間\n\n推奨アクション:\n• クリティカルアクションから優先的に対応してください\n• AI生成コードの修正は特に注意が必要です\n• テストとレビューを必ず実施してください`);
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(249, 115, 22, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                        <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px', fontWeight: '500' }}>重要アクション</div>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#f97316', marginBottom: '4px' }}>
                          {actionPlan.summary.critical}
                        </div>
                        <div style={{ fontSize: '10px', color: '#f97316', fontWeight: 'bold', marginBottom: '4px' }}>
                          🚨 至急対応
                        </div>
                        <div style={{ fontSize: '9px', color: '#666', lineHeight: '1.2' }}>
                          推定: 約{Math.round(totalHours)}時間
                        </div>
                        <div style={{ 
                          position: 'absolute', 
                          top: '4px', 
                          right: '4px', 
                          fontSize: '10px', 
                          color: '#999',
                          opacity: 0.7
                        }}>
                          🔍
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Level 2: どこが問題か（中段） */}
            <div style={{ marginBottom: '12px' }}>
              <div 
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '6px',
                  backgroundColor: expandedSections.level2 ? '#f3f4f6' : 'transparent'
                }}
                onClick={() => toggleSection('level2')}
              >
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#262626' }}>
                  🔥 問題特定と改善優先度
                </h3>
                <span style={{ fontSize: '14px', color: '#666' }}>
                  {expandedSections.level2 ? '▼' : '▶'}
                </span>
              </div>
              
              {expandedSections.level2 && (
                <div>
                  {/* 技術的負債ヒートマップ */}
                  <TechDebtHeatmap analysis={analysisResult} />
                  
                  {/* リファクタ優先度エンジン */}
                  <RefactorPriorityEngine analysis={analysisResult} />
                  
                  {/* 改善アクション自動生成エンジン */}
                  <ImprovementActionEngine analysis={analysisResult} />
                </div>
              )}
            </div>

            {/* Level 3: 理解支援（下段・折りたたみ） */}
            <div>
              <div 
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '6px',
                  backgroundColor: expandedSections.level3 ? '#f3f4f6' : 'transparent'
                }}
                onClick={() => toggleSection('level3')}
              >
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#262626' }}>
                  📖 詳細分析と理解支援
                  {(() => {
                    if (analysisResult.type !== 'zip' || !analysisResult.files) return '';
                    const criticalCount = analysisResult.files.filter(f => calculateFileRiskScore(f) >= 70).length;
                    if (criticalCount > 0 && !expandedSections.level3) {
                      return (
                        <span style={{ 
                          marginLeft: '8px', 
                          fontSize: '12px', 
                          color: '#ef4444',
                          backgroundColor: '#fee2e2',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 'bold'
                        }}>
                          ⚠️ {criticalCount} critical files hidden
                        </span>
                      );
                    }
                    return '';
                  })()}
                </h3>
                <span style={{ fontSize: '14px', color: '#666' }}>
                  {expandedSections.level3 ? '▼' : '▶'}
                </span>
              </div>
              
              {expandedSections.level3 && (
                <div>
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

                  {/* 改善提案 */}
                  <ImprovementSuggestions analysis={analysisResult} />

                  {/* リスクヒートマップ */}
                  <RiskHeatmapWithFixes analysis={analysisResult} />

                  {/* ファイル詳細 */}
                  {selectedFileInZip && (
                    <FileDetailView file={selectedFileInZip} onBack={() => setSelectedFileInZip(null)} />
                  )}
                </div>
              )}
            </div>

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
