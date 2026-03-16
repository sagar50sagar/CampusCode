// database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to the SQLite database (creates 'campuscode.db' if it doesn't exist)
const dbPath = path.resolve(__dirname, 'campuscode.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
    } else {
        console.log('✅ Connected to SQLite database.');
        
        db.serialize(() => {
            // ==========================================
            // 1. USERS TABLE
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL, 
                fullName TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL, 
                password TEXT NOT NULL, 
                collegeName TEXT, 
                status TEXT DEFAULT 'active'
            )`, (err) => {
                if (err) console.error("Error creating users table:", err.message);
            });

            // ==========================================
            // 2. OTPS TABLE (For email verification)
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS otps (
                email TEXT PRIMARY KEY, 
                code TEXT NOT NULL, 
                expiry INTEGER NOT NULL
            )`, (err) => {
                if (err) console.error("Error creating otps table:", err.message);
            });

            // ==========================================
            // 3. COLLEGES TABLE
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS colleges (
                id INTEGER PRIMARY KEY AUTOINCREMENT, 
                name TEXT UNIQUE NOT NULL,
                status TEXT DEFAULT 'active', 
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) console.error("Error creating colleges table:", err.message);
            });

            // ==========================================
            // 4. DEFAULT SUPERADMIN ACCOUNT
            // ==========================================
            // Insert the default SuperAdmin if it doesn't already exist
            const superAdminEmail = 'super@campuscode.com';
            const superAdminPassword = 'super123'; // Change this in production!

            db.get(`SELECT * FROM users WHERE email = ?`, [superAdminEmail], (err, row) => {
                if (err) {
                    console.error("Error checking for default superadmin:", err.message);
                } else if (!row) {
                    db.run(`INSERT INTO users (role, fullName, email, password, status) 
                            VALUES ('superadmin', 'Platform Admin', ?, ?, 'active')`, 
                        [superAdminEmail, superAdminPassword], 
                        (err) => {
                            if (err) console.error("Error inserting default superadmin:", err.message);
                            else console.log("✅ Default SuperAdmin account created.");
                        }
                    );
                }
            });
        });
    }
});

// Export the database instance so other files can use it
module.exports = db;