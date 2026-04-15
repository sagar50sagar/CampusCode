const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'campuscode.db');
const db = new sqlite3.Database(dbPath);

const facultyId = 2; // Assuming a faculty ID for testing
const collegeName = 'Test College';

console.log('--- Verification Script ---');

db.all(`
    SELECT sa.subject, sa.year, sa.section, COUNT(sa.user_id) as student_count
    FROM student_assignments sa
    JOIN faculty_assignments fa ON sa.subject = fa.subject AND sa.year = fa.year AND sa.section = fa.section
    WHERE fa.user_id = ?
    GROUP BY sa.subject, sa.year, sa.section
`, [facultyId], (err, rows) => {
    if (err) {
        console.error('Error:', err);
    } else {
        console.log('Assigned Student Counts per Subject/Year/Section for Faculty ID 2:');
        console.table(rows);
    }
    db.close();
});
