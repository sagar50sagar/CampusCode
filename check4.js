const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./campuscode.db');

db.serialize(() => {
    db.all("SELECT p.id, p.title, p.visibility_scope, p.faculty_id, u.collegeName FROM problems p JOIN users u ON p.faculty_id = u.id WHERE LOWER(p.visibility_scope) = 'global' AND p.status = 'accepted'", (err, rows) => {
        if (err) throw err;
        console.log('Global Problems details:', rows);
    });
});
db.close();
