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
                role TEXT NOT NULL DEFAULT 'pending', 
                fullName TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL, 
                password TEXT NOT NULL, 
                collegeName TEXT, 
                department TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                is_verified INTEGER DEFAULT 0,
                isVerified INTEGER DEFAULT 0,
                post TEXT DEFAULT '',
                gender TEXT DEFAULT '',
                mobile TEXT DEFAULT '',
                joiningDate TEXT DEFAULT '',
                course TEXT DEFAULT ''
            )`, (err) => {
                if (err) console.error("Error creating users table:", err.message);
                
                // Idempotent migrations for existing columns
                const userCols = [
                    { name: 'department', type: 'TEXT DEFAULT \'\'' },
                    { name: 'collegeName', type: 'TEXT DEFAULT \'\'' },
                    { name: 'status', type: 'TEXT DEFAULT \'active\'' },
                    { name: 'is_verified', type: 'INTEGER DEFAULT 0' },
                    { name: 'isVerified', type: 'INTEGER DEFAULT 0' },
                    { name: 'course', type: 'TEXT DEFAULT \'\'' },
                    { name: 'subject', type: 'TEXT DEFAULT \'\'' },
                    { name: 'year', type: 'TEXT DEFAULT \'N/A\'' },
                    { name: 'section', type: 'TEXT DEFAULT \'N/A\'' },
                    { name: 'points', type: 'INTEGER DEFAULT 0' },
                    { name: 'solvedCount', type: 'INTEGER DEFAULT 0' },
                    { name: 'rank', type: 'INTEGER DEFAULT 0' },
                    { name: 'branch', type: 'TEXT DEFAULT \'\'' },
                    { name: 'is_hod', type: 'INTEGER DEFAULT 0' },
                    { name: 'program', type: 'TEXT DEFAULT \'\'' }
                ];

                // Run migrations sequentially using a recursive helper to ensure all columns exist before creating indexes
                let i = 0;
                function runNextMigration() {
                    if (i < userCols.length) {
                        const col = userCols[i++];
                        db.run(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`, () => {
                            runNextMigration(); // Move to next column regardless of error (it might already exist)
                        });
                    } else {
                        // All columns processed, now safe to create indexes
                        db.run(`DROP INDEX IF EXISTS idx_hos_unique`);
                        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hos_unique ON users(collegeName, department, subject) WHERE role = 'hos' AND subject != ''`, (err) => {
                            if (err) console.error("Error creating HOS unique index:", err.message);
                        });

                        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hod_unique ON users(collegeName, department) WHERE role = 'hod'`, (err) => {
                            if (err) console.error("Error creating HOD unique index:", err.message);
                        });
                    }
                }
                runNextMigration();
            });

            // ==========================================
            // 2. USER ASSIGNMENTS TABLE
            // ==========================================
            // Stores user_id, subject, year, and section. (Admin -> HOD; HOD -> Faculty)
            db.run(`CREATE TABLE IF NOT EXISTS user_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subject TEXT NOT NULL,
                year TEXT NOT NULL,
                section TEXT NOT NULL,
                collegeName TEXT DEFAULT '',
                assigned_by_id INTEGER,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(assigned_by_id) REFERENCES users(id)
            )`, (err) => {
                if (err) console.error("Error creating user_assignments table:", err.message);
                
                // Add collegeName column if it doesn't exist (migration)
                db.run(`ALTER TABLE user_assignments ADD COLUMN collegeName TEXT DEFAULT ''`, () => {});
            });

            // ==========================================
            // 3. OTPS TABLE (For email verification)
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS otps (
                email TEXT PRIMARY KEY, 
                code TEXT NOT NULL, 
                expiry INTEGER NOT NULL
            )`, (err) => {
                if (err) console.error("Error creating otps table:", err.message);
            });

            // ==========================================
            // 4. COLLEGES TABLE
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
            // 5. PROBLEMS TABLE
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS problems (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                subject TEXT,
                difficulty TEXT,
                department TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                visibility_scope TEXT DEFAULT 'global',
                faculty_id INTEGER,
                input_format TEXT,
                output_format TEXT,
                constraints TEXT,
                sample_input TEXT,
                sample_output TEXT,
                hidden_test_cases TEXT,
                is_public INTEGER DEFAULT 0,
                hod_comments TEXT DEFAULT '',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(faculty_id) REFERENCES users(id)
            )`, (err) => {
                if (err) console.error("Error creating problems table:", err.message);
                const probCols = [
                    { name: 'status', type: 'TEXT DEFAULT \'pending\'' },
                    { name: 'visibility_scope', type: 'TEXT DEFAULT \'global\'' },
                    { name: 'faculty_id', type: 'INTEGER' },
                    { name: 'department', type: 'TEXT DEFAULT \'\'' },
                    { name: 'hod_comments', type: 'TEXT DEFAULT \'\'' },
                    { name: 'hos_verified', type: 'INTEGER DEFAULT 0' },
                    { name: 'hod_verified', type: 'INTEGER DEFAULT 0' }
                ];
                probCols.forEach(col => {
                    db.run(`ALTER TABLE problems ADD COLUMN ${col.name} ${col.type}`, () => {});
                });
            });

            // ==========================================
            // 6. CONTESTS TABLE
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS contests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                department TEXT DEFAULT '',
                subject TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                visibility_scope TEXT DEFAULT 'global',
                isVerified INTEGER DEFAULT 0,
                createdBy INTEGER,
                startDate DATETIME,
                endDate DATETIME,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(createdBy) REFERENCES users(id)
            )`, (err) => {
                if (err) console.error("Error creating contests table:", err.message);
                const contestCols = [
                    { name: 'department', type: 'TEXT DEFAULT \'\'' },
                    { name: 'subject', type: 'TEXT DEFAULT \'\'' },
                    { name: 'status', type: 'TEXT DEFAULT \'pending\'' },
                    { name: 'visibility_scope', type: 'TEXT DEFAULT \'global\'' },
                    { name: 'created_by', type: 'INTEGER' },
                    { name: 'isVerified', type: 'INTEGER DEFAULT 0' },
                    { name: 'scope', type: 'TEXT DEFAULT \'internal\'' },
                    { name: 'level', type: 'TEXT DEFAULT \'college\'' },
                    { name: 'date', type: 'TEXT' },
                    { name: 'deadline', type: 'TEXT' },
                    { name: 'duration', type: 'TEXT' },
                    { name: 'eligibility', type: 'TEXT' },
                    { name: 'description', type: 'TEXT' },
                    { name: 'rulesAndDescription', type: 'TEXT' },
                    { name: 'colleges', type: 'TEXT DEFAULT \'[]\'' },
                    { name: 'problems', type: 'TEXT DEFAULT \'[]\'' },
                    { name: 'hos_verified', type: 'INTEGER DEFAULT 0' },
                    { name: 'hod_verified', type: 'INTEGER DEFAULT 0' },
                    { name: 'collegeName', type: 'TEXT DEFAULT \'\'' }
                ];
                contestCols.forEach(col => {
                    db.run(`ALTER TABLE contests ADD COLUMN ${col.name} ${col.type}`, () => {});
                });
            });

            // ==========================================
            // 6.5. CONTEST PROBLEMS TABLE
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS contest_problems (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contest_id INTEGER NOT NULL,
                problem_id INTEGER NOT NULL,
                FOREIGN KEY(contest_id) REFERENCES contests(id) ON DELETE CASCADE,
                FOREIGN KEY(problem_id) REFERENCES problems(id) ON DELETE CASCADE
            )`, (err) => {
                if (err) console.error("Error creating contest_problems table:", err.message);
            });

    // ==========================================
    // 7. ACADEMIC ERP TABLES (Programs, Branches, Sections, Subjects)
    // ==========================================
    db.run(`CREATE TABLE IF NOT EXISTS programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        type TEXT DEFAULT 'UG',
        duration INTEGER,
        collegeName TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error("Error creating programs table:", err.message);
    });

    db.run(`CREATE TABLE IF NOT EXISTS branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        abbreviation TEXT,
        collegeName TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
    )`, (err) => {
        if (err) console.error("Error creating branches table:", err.message);
    });

    db.run(`CREATE TABLE IF NOT EXISTS sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        semester INTEGER NOT NULL,
        capacity INTEGER,
        collegeName TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE
    )`, (err) => {
        if (err) console.error("Error creating sections table:", err.message);
    });

    db.run(`CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        credits INTEGER,
        collegeName TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE CASCADE
    )`, (err) => {
        if (err) console.error("Error creating subjects table:", err.message);
    });

    // ==========================================
    // 8. DEFAULT SUPERADMIN ACCOUNT
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