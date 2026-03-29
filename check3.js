const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./campuscode.db');

db.serialize(() => {
    db.all("SELECT id, fullName, role, collegeName, department FROM users WHERE role = 'hos'", (err, rows) => {
        if (err) throw err;
        console.log('HOS Users:', rows);
    });
});
db.close();
