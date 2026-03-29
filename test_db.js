const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    db.get(\"SELECT COUNT(*) as count FROM problems WHERE LOWER(visibility_scope) = 'global' AND status = 'accepted'\", (err, row) => {
        if (err) throw err;
        console.log('Total global accepted problems in DB:', row.count);
    });
});
db.close();
