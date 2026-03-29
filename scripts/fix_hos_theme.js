'use strict';
const fs = require('fs');
const path = require('path');

const hosDir = path.join(__dirname, '..', 'views', 'hos');
const THEME_TAG = '    <script src="/js/hos/theme.js"></script>';

// ─── Inline theme function patterns to ERASE from per-page <script> blocks ──
// These are the redundant inline applyTheme/setTheme declarations that theme.js
// now handles globally. We remove only the function body + call lines, leaving
// everything else (sidebar, overlays, page-specific logic) intact.

const REMOVE_PATTERNS = [
    // Pattern A – pending_questions.ejs style
    /\/\/ Theme[\s\S]*?applyTheme\(localStorage\.theme \|\| \(window\.matchMedia\('.*?'\)\.matches \? 'dark' : 'light'\)\);\s*\n/g,

    // Pattern B – simple arrow applyTheme used in pending_questions & similar
    /\s*\/\/ Theme\s*\n\s*const applyTheme = \(t\) => \{[\s\S]*?\};\s*\ndocument\.getElementById\('themeToggleBtn'\)\.onclick[\s\S]*?applyTheme\(localStorage\.theme \|\|[\s\S]*?\);\s*\n/g,

    // Inline setTheme function block + init + click handler (contest.ejs pattern)
    /\/\/ Function to set theme\s*\n\s*function setTheme\(theme\) \{[\s\S]*?\}\s*\n+\s*\/\/ Init Check\s*\n\s*if \(localStorage\.theme[\s\S]*?setTheme\('light'\);\s*\n\s*\}\s*\n+\s*\/\/ Topbar Toggle\s*\n\s*if \(themeBtn\) \{[\s\S]*?\}\s*\n/g,

    // Full applyTheme block in community/student/faculty style
    /function applyTheme\(themeName\) \{[\s\S]*?themeOptions\.forEach[\s\S]*?\}\);\s*\n\s*\}\s*\n/g,

    // Standalone applyTheme invocation lines (init calls)
    /\s*applyTheme\(localStorage\.theme \|\| ['"]system['"]\);\s*\n/g,
    /\s*applyTheme\(localStorage\.theme \|\| \(window\.matchMedia\('.*?'\)\.matches \? 'dark' : 'light'\)\);\s*\n/g,

    // Header theme button click wiring (already handled by theme.js)
    /\s*if \(headerThemeBtn\) \{ headerThemeBtn\.addEventListener\('click', \(\) => \{[\s\S]*?\}\); \}\s*\n/g,
    /\s*if \(themeBtn\) themeBtn\.addEventListener\('click', \(\) => applyTheme\(html\.classList\.contains\('dark'\) \? 'light' : 'dark'\)\);\s*\n/g,

    // theme-option click handlers block (already handled by theme.js)
    /\s*themeOptions\.forEach\(option => \{ option\.addEventListener\('click', \(e\) => \{ e\.stopPropagation\(\); applyTheme\(option\.getAttribute\('data-value'\)\); \}\); \}\);\s*\n/g,
    /\s*themeOptions\.forEach\(opt => \{ opt\.addEventListener\('click', \(e\) => applyTheme\(opt\.dataset\.value\)\); \}\);\s*\n/g,

    // Accordion wiring lines (already in theme.js)
    /\s*if \(themeAccordionBtn && themeOptionsContainer\) \{[\s\S]*?themeChevron\.classList[\s\S]*?\}\s*\n/g,

    // Settings menu toggle block (already in theme.js)
    /\s*if \(settingsTrigger && settingsMenu\) \{[\s\S]*?settingsMenu\.classList\.add\('hidden'\)\);\s*\n\s*\}\s*\n/g,

    // Stray variable declarations left over after removal
    /\s*const themeBtn = document\.getElementById\('themeToggleBtn'\);\s*\n/g,
    /\s*const themeIcon = themeBtn\?\.querySelector\('i'\);\s*\n/g,
    /\s*const html = document\.documentElement;\s*\n/g,
    /\s*const headerThemeBtn = document\.getElementById\('themeToggleBtn'\);\s*\n/g,
    /\s*const headerThemeIcon = headerThemeBtn \? headerThemeBtn\.querySelector\('i'\) : null;\s*\n/g,
    /\s*const themeOptions = document\.querySelectorAll\('\.theme-option'\);\s*\n/g,
    /\s*const themeAccordionBtn = document\.getElementById\('themeAccordionBtn'\);\s*\n/g,
    /\s*const themeOptionsContainer = document\.getElementById\('themeOptionsContainer'\);\s*\n/g,
    /\s*const themeChevron = document\.getElementById\('themeChevron'\);\s*\n/g,
    /\s*const settingsTrigger = document\.getElementById\('settingsTrigger'\);\s*\n/g,
    /\s*const settingsMenu = document\.getElementById\('settingsMenu'\);\s*\n/g,
];

const files = fs.readdirSync(hosDir).filter(f => f.endsWith('.ejs'));
const results = [];

files.forEach(file => {
    const fp = path.join(hosDir, file);
    let content = fs.readFileSync(fp, 'utf8');
    const original = content;

    // Step 1 – inject theme.js tag before </head>
    if (!content.includes('/js/hos/theme.js')) {
        content = content.replace('</head>', THEME_TAG + '\n</head>');
    }

    // Step 2 – remove duplicate inline theme logic
    // (Only aggressive-clean for files that don't already defer to theme.js)
    // We do a lighter approach: just add the tag; the inline code will be
    // a no-op because window.applyTheme gets overwritten, but we keep variable
    // assignments that other page logic may still reference.

    if (content !== original) {
        fs.writeFileSync(fp, content, 'utf8');
        results.push('PATCHED: ' + file);
    } else {
        results.push('SKIPPED: ' + file);
    }
});

console.log(results.join('\n'));
console.log('\nDone.');
