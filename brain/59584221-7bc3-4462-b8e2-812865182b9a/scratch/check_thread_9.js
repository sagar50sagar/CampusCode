const sqlite3 = require('sqlite3').verbose();
const dbPath = 'c:\\Users\\HP\\Desktop\\CampusCode\\campuscode.db';
const db = new sqlite3.Database(dbPath);

db.get('SELECT * FROM forum_threads WHERE id=9', (err, row) => {
    if (err) console.error(err);
    else console.log('Thread 9:', row);
    db.close();
});
