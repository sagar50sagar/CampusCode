const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'views/hos');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ejs'));

for (const file of files) {
    const fPath = path.join(dir, file);
    let content = fs.readFileSync(fPath, 'utf8');
    if (content.includes('"/logout"')) {
        content = content.replace(/"\/logout"/g, '"/auth/logout"');
        fs.writeFileSync(fPath, content);
        console.log('Fixed /logout -> /auth/logout in', file);
    }
}
