const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, 'src', 'views');
const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('.js'));

files.forEach(f => {
    let content = fs.readFileSync(path.join(viewsDir, f), 'utf-8');
    
    // Replace inline styles for buttons that say '👁️ Ver', 'Editar', '+ Abono', etc.
    // To match how the HTML is set up, let's remove inline styles explicitly and add btn-action class.
    
    // Pattern to match any <button ... > where we shouldn't target btn-primary or modal headers (&times;)
    // It's safer to just look for <button ...>
    
    // 1. Give btn-action class to inline-styled buttons that are actions
    content = content.replace(/<button[^>]+style="background:var\(--input-bg\);[^"]*"[^>]*>/g, match => {
        let clean = match.replace(/style="[^"]*"/, '').replace(/class="[^"]*"/, '');
        return clean.replace('<button', '<button class="btn-action"');
    });

    content = content.replace(/<button[^>]+style="background:var\(--glass-bg\);[^"]*"[^>]*>/g, match => {
        let clean = match.replace(/style="[^"]*"/, '').replace(/class="[^"]*"/, '');
        return clean.replace('<button', '<button class="btn-action"');
    });

    content = content.replace(/<button[^>]+style="background:#2A9D8F;[^"]*"[^>]*>/g, match => {
        let clean = match.replace(/style="[^"]*"/, '').replace(/class="[^"]*"/, '');
        return clean.replace('<button', '<button class="btn-action"');
    });

    // Make sure 'Editar' or any existing btn-action doesn't have inline styles
    content = content.replace(/<button class="btn-action" style="[^"]*"([^>]*)>/g, '<button class="btn-action"$1>');

    fs.writeFileSync(path.join(viewsDir, f), content);
    console.log('Processed', f);
});
