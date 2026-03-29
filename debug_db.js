const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'campuscode.db');
const db = new sqlite3.Database(dbPath);

console.log('--- USERS TABLE INFO ---');
db.all("PRAGMA table_info(users)", (err, rows) => {
    if (err) console.error(err);
    console.table(rows);
    
    console.log('--- PENDING USERS ---');
    db.all("SELECT id, fullName, email, role, is_verified, status FROM users WHERE role = 'pending' OR is_verified = 0", (err, users) => {
        if (err) console.error(err);
        console.table(users);
        db.close();
    });
});
