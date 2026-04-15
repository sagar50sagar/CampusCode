const sqlite3 = require('sqlite3').verbose();
const dbPath = 'c:\\Users\\HP\\Desktop\\CampusCode\\campuscode.db';
const db = new sqlite3.Database(dbPath);

db.all('SELECT name, sql FROM sqlite_master WHERE name LIKE "forum_%"', (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        rows.forEach(r => {
            console.log(`--- Table: ${r.name} ---`);
            console.log(r.sql);
            console.log('\n');
        });
    }
    db.close();
});
