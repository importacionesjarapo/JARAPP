const fs = require('fs');

// 1. Fix main.js btn styles
let mainCode = fs.readFileSync('src/main.js', 'utf8');
mainCode = mainCode.replace(
  /\.btn-action \{.*?\}/g,
  '.btn-action { background:transparent; border:1px solid var(--info-blue); color:var(--info-blue); padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.75rem; font-weight:700; transition:0.3s; }'
);
mainCode = mainCode.replace(
  /\.btn-action:hover \{.*?\}/g,
  '.btn-action:hover { background:var(--info-blue); color:#fff; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }'
);
fs.writeFileSync('src/main.js', mainCode);

// 2. Fix all view files for remaining hardcoded RGBA / colors
const files = fs.readdirSync('src/views').filter(f => f.endsWith('.js')).map(f => 'src/views/' + f);

files.forEach(f => {
  let c = fs.readFileSync(f, 'utf8');
  
  // Replace white text with text-main
  c = c.replace(/color:\s*#fff(?:;?)/gi, 'color:var(--text-main);');
  c = c.replace(/color:\s*white(?:;?)/gi, 'color:var(--text-main);');
  
  // Clean up inline RGBA borders
  c = c.replace(/border:\s*1px solid rgba\(255,255,255,0\.05\);?/gi, 'border: 1px solid var(--glass-border);');
  c = c.replace(/border:\s*1px solid rgba\(255,255,255,0\.1\);?/gi, 'border: 1px solid var(--glass-border);');
  c = c.replace(/border-top:\s*1px solid rgba\(255,255,255,0\.05\);?/gi, 'border-top: 1px solid var(--glass-border);');
  
  // Make client boxes or generic internal info-boxes more distinct
  c = c.replace(/background:rgba\(255,255,255,0\.02\)/gi, 'background:var(--input-bg)');
  c = c.replace(/background:var\(--glass-hover\);\s*padding:1rem/gi, 'background:var(--input-bg); box-shadow:0 2px 8px rgba(0,0,0,0.05); padding:1rem');
  
  // Fix "Ver" buttons which might have hardcoded opacity text/background
  c = c.replace(/style="background:rgba\(255,255,255,0\.1\);/gi, 'style="background:var(--input-bg); border:1px solid var(--glass-border);');
  c = c.replace(/style="background:rgba\(255,255,255,0\.05\);/gi, 'style="background:var(--input-bg); border:1px solid var(--glass-border);');

  fs.writeFileSync(f, c);
});

// 3. Fix style.css specific values (Make Green stronger in light mode)
let styleCode = fs.readFileSync('src/style.css', 'utf8');
styleCode = styleCode.replace(/--success-green:\s*#039A6A;/g, '--success-green: #047857;'); // Emerald-700
// Add shadow logic to table headers or cards
if (!styleCode.includes('--glass-border: rgba(0, 0, 0, 0.25);')) {
    styleCode = styleCode.replace(/--glass-border: rgba\(0, 0, 0, 0\.18\);/g, '--glass-border: rgba(0, 0, 0, 0.25);'); // Much darker lines
}
if (!styleCode.includes('--input-bg: #EAEFF4;')) {
    styleCode = styleCode.replace(/--input-bg: #F8FAFC;/g, '--input-bg: #EAEFF4;'); // Darker input box / component bg to stand out against white cards
}
fs.writeFileSync('src/style.css', styleCode);

console.log('Done deep-styling components');
