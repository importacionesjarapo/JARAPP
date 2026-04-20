const fs = require('fs');
const files = [
  'src/main.js',
  'src/views/clients.js',
  'src/views/dashboard.js',
  'src/views/finance.js',
  'src/views/inventory.js',
  'src/views/logistics.js',
  'src/views/params.js',
  'src/views/sales.js',
  'src/views/settings.js'
];

files.forEach(f => {
  if (fs.existsSync(f)) {
    let c = fs.readFileSync(f, 'utf8');
    c = c.replace(/#06D6A0/gi, 'var(--success-green)');
    c = c.replace(/#F4A261/gi, 'var(--warning-orange)');
    c = c.replace(/#457B9D/gi, 'var(--info-blue)');
    // Nota: primary red ya suele ser var(--primary-red), pero por si acaso hay un hexadecimal volando:
    c = c.replace(/#E63946/gi, 'var(--primary-red)');
    
    // Para Chart.js que no soporta vars CSS nativamente dentro del canvas
    // Tenemos que revisar chart.js, pero en HTML si funciona el CSS var
    
    fs.writeFileSync(f, c);
  }
});
console.log('Colors replaced successfully!');
