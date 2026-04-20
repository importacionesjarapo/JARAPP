const fs = require('fs');
const files = ['inventory.js', 'sales.js', 'finance.js', 'logistics.js', 'params.js', 'dashboard.js', 'settings.js'];
files.forEach(f => {
  let c = fs.readFileSync('src/views/' + f, 'utf8');
  c = c.replace(/color:\s*(#fff|white|#FFF)(;?)/g, 'color:var(--text-main)$2');
  c = c.replace(/color:\s*(#fff|white|#FFF)(")/g, 'color:var(--text-main)$2');
  
  c = c.replace(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.0[23458]\)/g, 'background:var(--glass-hover)');
  c = c.replace(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.1[0-9]?\)/g, 'background:var(--glass-bg)');
  
  c = c.replace(/border(-[a-z]+)?:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.[0-9]+\)/g, 'border$1:1px solid var(--glass-border)');
  
  c = c.replace(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.9\)/g, 'background:var(--modal-bg)');
  c = c.replace(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.3\)/g, 'background:var(--input-bg)');
  
  fs.writeFileSync('src/views/' + f, c);
});
console.log('Done');
