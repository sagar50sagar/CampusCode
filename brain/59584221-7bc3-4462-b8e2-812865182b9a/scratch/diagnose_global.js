const sqlite3 = require('sqlite3').verbose();
const dbPath = 'c:\\Users\\HP\\Desktop\\CampusCode\\campuscode.db';
const db = new sqlite3.Database(dbPath);

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
        console.log('--- GLOBAL STUDENT CHECK ---');
        
        const collegeCount = await runQuery(`SELECT COUNT(*) as count FROM colleges`);
        console.log('Total Colleges:', collegeCount[0].count);
        
        const colleges = await runQuery(`SELECT name FROM colleges LIMIT 10`);
        console.log('College Names:', colleges.map(c => c.name));

        const studentCount = await runQuery(`SELECT COUNT(*) as count FROM users WHERE role = 'student'`);
        console.log('Total Students:', studentCount[0].count);

        const facultyCount = await runQuery(`SELECT COUNT(*) as count FROM users WHERE role = 'faculty'`);
        console.log('Total Faculty:', facultyCount[0].count);

        if (studentCount[0].count > 0) {
            const sampleStudents = await runQuery(`SELECT fullName, collegeName, year, section FROM users WHERE role = 'student' LIMIT 5`);
            console.log('\nSample Students:', sampleStudents);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        db.close();
    }
}

diagnose();
