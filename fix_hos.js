const fs = require('fs');
const path = require('path');

// 1. Remove logout from all sidebars in views/hos
const dir = path.join(__dirname, 'views/hos');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ejs'));

const regex = /\s*<a href="\/logout"[\s\S]*?<i class="fas fa-sign-out-alt[\s\S]*?<\/a>\s*/;

for (const file of files) {
    const fPath = path.join(dir, file);
    let content = fs.readFileSync(fPath, 'utf8');
    if (regex.test(content)) {
        content = content.replace(regex, '\n\n');
        fs.writeFileSync(fPath, content);
        console.log('Removed sidebar logout from', file);
    }
}

// 2. Remove stats cards from student.ejs
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

// 3. Update public/js/index1_logic.js for logout route
const logicPath = path.join(__dirname, 'public/js/index1_logic.js');
if (fs.existsSync(logicPath)) {
    let logicContent = fs.readFileSync(logicPath, 'utf8');
    logicContent = logicContent.replace(/window\.location\.href\s*=\s*['"]index\.html['"];/g, "window.location.href = '/auth/logout';");
    fs.writeFileSync(logicPath, logicContent);
    console.log('Updated logout route in index1_logic.js');
}

// 4. Update public/js/hos/index1_logic.js if exists
const hosLogicPath = path.join(__dirname, 'public/js/hos/index1_logic.js');
if (fs.existsSync(hosLogicPath)) {
    let hosLogicContent = fs.readFileSync(hosLogicPath, 'utf8');
    hosLogicContent = hosLogicContent.replace(/window\.location\.href\s*=\s*['"]index\.html['"];/g, "window.location.href = '/auth/logout';");
    fs.writeFileSync(hosLogicPath, hosLogicContent);
    console.log('Updated logout route in hos/index1_logic.js');
}
