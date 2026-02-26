export function analyzeTechStack(files: { path: string; content: string }[]) {
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const runtime = new Set<string>();
  const packageManagers = new Set<string>();
  const buildTools = new Set<string>();
  
  for (const file of files) {
    const content = file.content.toLowerCase();
    const path = file.path.toLowerCase();
    
    // 言語検出
    if (path.includes('.ts') || path.includes('.tsx')) {
      languages.add('TypeScript');
    } else if (path.includes('.js') || path.includes('.jsx')) {
      languages.add('JavaScript');
    } else if (path.includes('.css')) {
      languages.add('CSS');
    } else if (path.includes('.html')) {
      languages.add('HTML');
    } else if (path.includes('.json')) {
      languages.add('JSON');
    }
    
    // フレームワーク検出
    if (content.includes('import react') || content.includes('from "react"')) {
      frameworks.add('React');
    }
    if (content.includes('next.js') || content.includes('next/')) {
      frameworks.add('Next.js');
    }
    if (content.includes('vue')) {
      frameworks.add('Vue.js');
    }
    if (content.includes('angular')) {
      frameworks.add('Angular');
    }
    if (content.includes('express')) {
      frameworks.add('Express.js');
    }
    if (content.includes('fastify')) {
      frameworks.add('Fastify');
    }
    
    // ランタイム検出
    if (content.includes('node.js') || content.includes('require(')) {
      runtime.add('Node.js');
    }
    if (content.includes('deno')) {
      runtime.add('Deno');
    }
    if (content.includes('bun')) {
      runtime.add('Bun');
    }
    
    // パッケージマネージャー検出
    if (content.includes('npm ')) {
      packageManagers.add('npm');
    }
    if (content.includes('yarn')) {
      packageManagers.add('Yarn');
    }
    if (content.includes('pnpm')) {
      packageManagers.add('pnpm');
    }
    
    // ビルドツール検出
    if (content.includes('vite')) {
      buildTools.add('Vite');
    }
    if (content.includes('webpack')) {
      buildTools.add('Webpack');
    }
    if (content.includes('rollup')) {
      buildTools.add('Rollup');
    }
    if (content.includes('parcel')) {
      buildTools.add('Parcel');
    }
    if (content.includes('turbopack')) {
      buildTools.add('Turbopack');
    }
  }
  
  return {
    languages: Array.from(languages),
    frameworks: Array.from(frameworks),
    runtime: Array.from(runtime),
    packageManagers: Array.from(packageManagers),
    buildTools: Array.from(buildTools)
  };
}
