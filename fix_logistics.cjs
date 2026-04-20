const fs = require('fs');
let c = fs.readFileSync('src/views/logistics.js', 'utf8');
c = c.replace(/\\`/g, '`');
c = c.replace(/\\\$/g, '$');
fs.writeFileSync('src/views/logistics.js', c);
console.log('Fixed logistics.js');
