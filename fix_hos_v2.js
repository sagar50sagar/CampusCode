const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'views/hos');
const ejsFiles = fs.readdirSync(dir).filter(f => f.endsWith('.ejs'));

const targetLogoutBlock = `
                <a href="/logout"
                    class="group flex items-center gap-3 px-6 py-3.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all rounded-lg">
                    <i class="fas fa-sign-out-alt w-5 text-center text-lg group-hover:translate-x-1 transition-transform"></i>
                    <span class="whitespace-nowrap text-nowrap">Logout</span>
                </a>`;

// 1. Remove sidebar logout
for (const file of ejsFiles) {
    const p = path.join(dir, file);
    let content = fs.readFileSync(p, 'utf8');
    if (content.includes(targetLogoutBlock)) {
        content = content.replace(targetLogoutBlock, '');
        fs.writeFileSync(p, content);
        console.log('Removed from', file);
    }
}

// 1b. The user might have meant `<a href="/logout"` in some other format? 
// Let's also check for a 1-line version just in case:
for (const file of ejsFiles) {
    const p = path.join(dir, file);
    let content = fs.readFileSync(p, 'utf8');
    const oneliner = `<a href="/logout" class="group flex items-center gap-3 px-6 py-3.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all rounded-lg"><i class="fas fa-sign-out-alt w-5 text-center text-lg group-hover:translate-x-1 transition-transform"></i><span class="whitespace-nowrap text-nowrap">Logout</span></a>`;
    if (content.includes(oneliner)) {
        content = content.replace(oneliner, '');
        fs.writeFileSync(p, content);
        console.log('Removed oneliner from', file);
    }
}

// 2. Remove student cards
const studentPath = path.join(dir, 'student.ejs');
if (fs.existsSync(studentPath)) {
    let studentContent = fs.readFileSync(studentPath, 'utf8');
    const startStr = '<!-- STATS DASHBOARD -->';
    const endStr = '<div id="student-list-container"';
    const startIndex = studentContent.indexOf(startStr);
    const endIndex = studentContent.indexOf(endStr);
    if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
        studentContent = studentContent.substring(0, startIndex) + studentContent.substring(endIndex);
        fs.writeFileSync(studentPath, studentContent);
        console.log('Removed cards from student.ejs');
    }
}

// 3. Fix logic route
const logicPaths = ['public/js/index1_logic.js', 'public/js/hos/index1_logic.js', 'public/js/hod/index1_logic.js', 'public/js/faculty/index1_logic.js'];
for (const lp of logicPaths) {
    const fullPath = path.join(__dirname, lp);
    if (fs.existsSync(fullPath)) {
        let logicContent = fs.readFileSync(fullPath, 'utf8');
        logicContent = logicContent.replace(/window\.location\.href\s*=\s*'index\.html';/g, "window.location.href = '/auth/logout';");
        logicContent = logicContent.replace(/window\.location\.href\s*=\s*'\/logout';/g, "window.location.href = '/auth/logout';");
        fs.writeFileSync(fullPath, logicContent);
        console.log('Updated logout route in', lp);
    }
}
