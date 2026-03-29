const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'views/hos');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ejs'));

for (const file of files) {
    const fPath = path.join(dir, file);
    let content = fs.readFileSync(fPath, 'utf8');
    let modified = false;

    if (content.includes("window.location.href = '/logout'")) {
        content = content.replace(/window\.location\.href\s*=\s*'\/logout'/g, "window.location.href = '/auth/logout'");
        modified = true;
    }
    if (content.includes("window.location.href = 'index.html'")) {
        content = content.replace(/window\.location\.href\s*=\s*'index\.html'/g, "window.location.href = '/auth/logout'");
        modified = true;
    }
    
    // Also remove the standalone logout button in settings.ejs which had bg-red-600 white text
    const redLogoutBtn = `<a href="/logout" class="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors">`;
    if (content.includes(redLogoutBtn)) {
        content = content.replace(redLogoutBtn, `<a href="/auth/logout" class="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors">`);
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(fPath, content);
        console.log('Fixed inline logout in', file);
    }
}
