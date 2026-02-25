const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const yauzl = require('yauzl');
const StreamZip = require('node-stream-zip');
const Node7z = require('node-7z');
const tar = require('tar');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
function isSupportedFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (isSupportedFile(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('サポートされていないファイル形式です。コードファイルまたはアーカイブファイルのみアップロードできます。'), false);
    }
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'ファイルがアップロードされていません' });
    }

    // 追加のファイルタイプチェック
    if (!isSupportedFile(req.file.originalname)) {
      return res.status(400).json({ 
        error: 'サポートされていないファイル形式です。コードファイル（.js, .ts, .py, .javaなど）またはアーカイブファイル（.zip, .rar, .7zなど）のみアップロードできます。' 
      });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    
    let analysisResult;
    
    if (originalName.endsWith('.zip')) {
      analysisResult = await analyzeZipFile(filePath);
    } else if (originalName.endsWith('.rar')) {
      analysisResult = await analyzeRarFile(filePath);
    } else if (originalName.endsWith('.7z')) {
      analysisResult = await analyze7zFile(filePath);
    } else if (originalName.endsWith('.tar') || originalName.endsWith('.tar.gz') || originalName.endsWith('.tgz') || originalName.endsWith('.tar.bz2')) {
      analysisResult = await analyzeTarFile(filePath);
    } else {
      analysisResult = await analyzeSingleFile(filePath, originalName);
    }

    fs.unlinkSync(filePath);

    res.json({
      success: true,
      fileName: originalName,
      analysis: analysisResult
    });

  } catch (error) {
    console.error('分析エラー:', error);
    res.status(500).json({ error: 'ファイルの分析中にエラーが発生しました' });
  }
});

async function analyzeSingleFile(filePath, fileName) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileExtension = path.extname(fileName).toLowerCase();
  
  return {
    type: 'single',
    language: detectLanguage(fileExtension, content),
    technologies: detectTechnologies(content, fileExtension),
    size: fs.statSync(filePath).size,
    lines: content.split('\n').length,
    fileName: fileName,
    structure: analyzeCodeStructure(content, fileExtension)
  };
}

async function analyzeZipFile(zipPath) {
  return new Promise((resolve, reject) => {
    const results = [];
    
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }

      zipfile.readEntry();
      
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
        } else {
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              reject(err);
              return;
            }
            
            const chunks = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => {
              const content = Buffer.concat(chunks).toString('utf8');
              const fileExtension = path.extname(entry.fileName).toLowerCase();
              
              try {
                const analysis = {
                  fileName: entry.fileName,
                  language: detectLanguage(fileExtension, content),
                  technologies: detectTechnologies(content, fileExtension),
                  size: entry.size,
                  lines: content.split('\n').length,
                  structure: analyzeCodeStructure(content, fileExtension)
                };
                results.push(analysis);
              } catch (error) {
                console.error(`ファイル分析エラー: ${entry.fileName}`, error);
              }
              
              zipfile.readEntry();
            });
          });
        }
      });
      
      zipfile.on('end', () => {
        resolve({
          type: 'zip',
          totalFiles: results.length,
          files: results,
          summary: generateSummary(results)
        });
      });
    });
  });
}

function detectLanguage(extension, content) {
  const languageMap = {
    '.js': 'JavaScript',
    '.jsx': 'React (JavaScript)',
    '.ts': 'TypeScript',
    '.tsx': 'React (TypeScript)',
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
    '.scss': 'SCSS',
    '.sass': 'SASS',
    '.less': 'LESS',
    '.json': 'JSON',
    '.xml': 'XML',
    '.yaml': 'YAML',
    '.yml': 'YAML',
    '.md': 'Markdown',
    '.sql': 'SQL',
    '.sh': 'Shell Script',
    '.vue': 'Vue.js',
    '.svelte': 'Svelte'
  };
  
  return languageMap[extension] || 'Unknown';
}

function detectTechnologies(content, extension) {
  const technologies = [];
  
  const frameworkPatterns = {
    'React': /import\s+.*from\s+['"]react['"]|React\./,
    'Vue': /import\s+.*from\s+['"]vue['"]|Vue\./,
    'Angular': /import\s+.*from\s+['"]@angular['"]/,
    'Express': /require\s*\(\s*['"]express['"]\s*\)|import.*from\s+['"]express['"]/,
    'Next.js': /import\s+.*from\s+['"]next['"]/,
    'Nuxt.js': /import\s+.*from\s+['"]@nuxt['"]/,
    'Django': /from\s+django|import\s+django/,
    'Flask': /from\s+flask|import\s+flask/,
    'Spring': /import\s+org\.springframework/,
    'Laravel': /use\s+Illuminate\\/,
    'Rails': /require\s+['"]rails['"]|Rails\./,
    'Bootstrap': /bootstrap|Bootstrap/,
    'Tailwind': /tailwindcss|@tailwind/,
    'Material-UI': /@mui\/|@material-ui/,
    'Ant Design': /antd|@ant-design/,
    'jQuery': /\$\(|jQuery/,
    'Redux': /redux|@reduxjs/,
    'MobX': /mobx/,
    'GraphQL': /graphql|@apollo/,
    'Socket.io': /socket\.io/,
    'WebSocket': /WebSocket/,
    'Docker': /FROM\s+|docker-compose/,
    'Kubernetes': /k8s|kubernetes/,
    'TypeScript': /:.*string|:.*number|interface\s+/,
    'MongoDB': /mongodb|mongoose/,
    'PostgreSQL': /pg|postgres/,
    'MySQL': /mysql/,
    'Redis': /redis/,
    'Elasticsearch': /elasticsearch/,
    'Jest': /jest|@jest/,
    'Cypress': /cypress/,
    'Playwright': /playwright/,
    'Webpack': /webpack/,
    'Vite': /vite/,
    'Babel': /@babel/,
    'ESLint': /eslint/,
    'Prettier': /prettier/
  };
  
  for (const [tech, pattern] of Object.entries(frameworkPatterns)) {
    if (pattern.test(content)) {
      technologies.push(tech);
    }
  }
  
  return technologies;
}

function analyzeCodeStructure(content, extension) {
  const structure = {
    functions: [],
    classes: [],
    imports: [],
    exports: []
  };
  
  if (['.js', '.jsx', '.ts', '.tsx'].includes(extension)) {
    structure.functions = content.match(/function\s+\w+|const\s+\w+\s*=\s*\(|=>\s*{/g) || [];
    structure.classes = content.match(/class\s+\w+/g) || [];
    structure.imports = content.match(/import\s+.+from\s+['"].+['"]/g) || [];
    structure.exports = content.match(/export\s+/g) || [];
  } else if (extension === '.py') {
    structure.functions = content.match(/def\s+\w+\(/g) || [];
    structure.classes = content.match(/class\s+\w+/g) || [];
    structure.imports = content.match(/import\s+\w+|from\s+\w+\s+import/g) || [];
  }
  
  return structure;
}

async function analyzeRarFile(rarPath) {
  try {
    const zip = new StreamZip.async({ file: rarPath });
    const entries = await zip.entries();
    const results = [];
    
    for (const [fileName, entry] of Object.entries(entries)) {
      if (!entry.isDirectory) {
        try {
          const content = await zip.entryData(fileName);
          const contentStr = content.toString('utf8');
          const fileExtension = path.extname(fileName).toLowerCase();
          
          const analysis = {
            fileName: fileName,
            language: detectLanguage(fileExtension, contentStr),
            technologies: detectTechnologies(contentStr, fileExtension),
            size: entry.size,
            lines: contentStr.split('\n').length,
            structure: analyzeCodeStructure(contentStr, fileExtension)
          };
          results.push(analysis);
        } catch (error) {
          console.error(`RARファイル解析エラー: ${fileName}`, error);
        }
      }
    }
    
    await zip.close();
    
    return {
      type: 'rar',
      totalFiles: results.length,
      files: results,
      summary: generateSummary(results)
    };
  } catch (error) {
    console.error('RAR解析エラー:', error);
    throw new Error('RARファイルの解析に失敗しました');
  }
}

async function analyze7zFile(archivePath) {
  try {
    const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
    const zipStream = Node7z.extractFull(archivePath, tempDir);
    
    return new Promise((resolve, reject) => {
      const results = [];
      
      zipStream.on('data', (data) => {
        // 処理中のデータ
      });
      
      zipStream.on('end', () => {
        try {
          const files = getAllFiles(tempDir);
          
          files.forEach(filePath => {
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              const fileName = path.relative(tempDir, filePath);
              const fileExtension = path.extname(fileName).toLowerCase();
              
              const analysis = {
                fileName: fileName,
                language: detectLanguage(fileExtension, content),
                technologies: detectTechnologies(content, fileExtension),
                size: fs.statSync(filePath).size,
                lines: content.split('\n').length,
                structure: analyzeCodeStructure(content, fileExtension)
              };
              results.push(analysis);
            } catch (error) {
              console.error(`7Zファイル解析エラー: ${filePath}`, error);
            }
          });
          
          // 一時ディレクトリを削除
          fs.rmSync(tempDir, { recursive: true, force: true });
          
          resolve({
            type: '7z',
            totalFiles: results.length,
            files: results,
            summary: generateSummary(results)
          });
        } catch (error) {
          reject(error);
        }
      });
      
      zipStream.on('error', (error) => {
        // 一時ディレクトリを削除
        fs.rmSync(tempDir, { recursive: true, force: true });
        reject(error);
      });
    });
  } catch (error) {
    console.error('7Z解析エラー:', error);
    throw new Error('7Zファイルの解析に失敗しました');
  }
}

async function analyzeTarFile(tarPath) {
  try {
    const tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
    
    await tar.extract({
      file: tarPath,
      cwd: tempDir,
      strip: 0
    });
    
    const results = [];
    const files = getAllFiles(tempDir);
    
    files.forEach(filePath => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const fileName = path.relative(tempDir, filePath);
        const fileExtension = path.extname(fileName).toLowerCase();
        
        const analysis = {
          fileName: fileName,
          language: detectLanguage(fileExtension, content),
          technologies: detectTechnologies(content, fileExtension),
          size: fs.statSync(filePath).size,
          lines: content.split('\n').length,
          structure: analyzeCodeStructure(content, fileExtension)
        };
        results.push(analysis);
      } catch (error) {
        console.error(`TARファイル解析エラー: ${filePath}`, error);
      }
    });
    
    // 一時ディレクトリを削除
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    return {
      type: 'tar',
      totalFiles: results.length,
      files: results,
      summary: generateSummary(results)
    };
  } catch (error) {
    console.error('TAR解析エラー:', error);
    throw new Error('TARファイルの解析に失敗しました');
  }
}

function getAllFiles(dirPath) {
  const files = [];
  
  function traverse(currentPath) {
    const items = fs.readdirSync(currentPath);
    
    for (const item of items) {
      const fullPath = path.join(currentPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        traverse(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  
  traverse(dirPath);
  return files;
}

function generateSummary(results) {
  const languages = {};
  const technologies = {};
  let totalSize = 0;
  let totalLines = 0;
  
  results.forEach(file => {
    languages[file.language] = (languages[file.language] || 0) + 1;
    totalSize += file.size;
    totalLines += file.lines;
    
    file.technologies.forEach(tech => {
      technologies[tech] = (technologies[tech] || 0) + 1;
    });
  });
  
  return {
    languages,
    technologies,
    totalSize,
    totalLines,
    averageFileSize: totalSize / results.length
  };
}

app.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
});
