const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const yauzl = require('yauzl');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const upload = multer({ storage: storage });

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'ファイルがアップロードされていません' });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    
    let analysisResult;
    
    if (originalName.endsWith('.zip')) {
      analysisResult = await analyzeZipFile(filePath);
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
