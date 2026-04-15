const sqlite3 = require('sqlite3').verbose();
const dbPath = 'c:\\Users\\HP\\Desktop\\CampusCode\\campuscode.db';
const db = new sqlite3.Database(dbPath);

console.log('Using DB Path:', dbPath);

async function runQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function diagnose() {
    try {
        console.log('--- DB DIAGNOSIS ---');
        
        const tables = await runQuery(`SELECT name FROM sqlite_master WHERE type='table'`);
        console.log('Tables in DB:', tables.map(t => t.name).join(', '));

        if (tables.length === 0) {
            console.log('WARNING: No tables found.');
            return;
        }

        const mitFaculty = await runQuery(`SELECT id, fullName, role, collegeName FROM users WHERE collegeName LIKE '%MIT%' AND role IN ('faculty', 'hos') LIMIT 5`);
        console.log('\nMIT Faculty:', mitFaculty);

        if (mitFaculty.length > 0) {
            for (const fac of mitFaculty) {
                const fAssignments = await runQuery(`SELECT * FROM faculty_assignments WHERE user_id = ?`, [fac.id]);
                console.log(`Assignments for Faculty ${fac.fullName} (ID ${fac.id}):`, fAssignments);
            }
        }

        const mitStudents = await runQuery(`SELECT id, fullName, year, section FROM users WHERE collegeName LIKE '%MIT%' AND role = 'student' LIMIT 5`);
        console.log('\nMIT Students (first 5):', mitStudents);

        const saCount = await runQuery(`SELECT COUNT(*) as count FROM student_assignments`);
        const faCount = await runQuery(`SELECT COUNT(*) as count FROM faculty_assignments`);
        console.log(`\nTotal Assignment Counts - Students: ${saCount[0].count}, Faculty: ${faCount[0].count}`);

    } catch (err) {
        console.error('Diagnosis Error:', err);
    } finally {
        db.close();
    }
}

diagnose();
