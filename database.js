// database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt'); // ⭐ Added to securely hash the default superadmin password

// Connect to the SQLite database (creates 'campuscode.db' if it doesn't exist)
const dbPath = path.resolve(__dirname, 'campuscode.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
    } else {
        console.log('✅ Connected to SQLite database.');
        
        db.serialize(() => {
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
                branch TEXT DEFAULT '',       /* ✅ Added to fix frontend missing data */
                program TEXT DEFAULT '',      /* ✅ Added to fix frontend missing data */
                year TEXT DEFAULT '',         /* ✅ Added to fix frontend missing data */
                section TEXT DEFAULT '',      /* ✅ Added to fix frontend missing data */
                status TEXT DEFAULT 'pending',
                is_verified INTEGER DEFAULT 0,
                isVerified INTEGER DEFAULT 0,
                post TEXT DEFAULT '',
                gender TEXT DEFAULT '',
                mobile TEXT DEFAULT '',
                joiningDate TEXT DEFAULT '',
                course TEXT DEFAULT '',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP  /* ✅ Added for Activity Feed and Monthly Trends */
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
                    { name: 'program', type: 'TEXT DEFAULT \'\'' },
                    { name: 'notif_contest_alerts', type: 'INTEGER DEFAULT 1' },
                    { name: 'notif_submission_results', type: 'INTEGER DEFAULT 1' },
                    { name: 'notif_deadline_reminders', type: 'INTEGER DEFAULT 1' },
                    { name: 'pending_college_name', type: 'TEXT DEFAULT \'\'' },
                    { name: 'college_request_status', type: 'TEXT DEFAULT \'\'' }
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

            // Keep legacy role/is_hod fields consistent for admin/HOD workflows.
            db.run(`UPDATE users
                    SET is_hod = 1
                    WHERE LOWER(TRIM(COALESCE(role, ''))) = 'hod'
                      AND COALESCE(is_hod, 0) = 0`, () => {});
            db.run(`UPDATE users
                    SET is_hod = 0
                    WHERE LOWER(TRIM(COALESCE(role, ''))) != 'hod'
                      AND COALESCE(is_hod, 0) != 0`, () => {});
            db.run(`UPDATE users
                    SET department = branch
                    WHERE TRIM(COALESCE(department, '')) = ''
                      AND TRIM(COALESCE(branch, '')) != ''`, () => {});
            db.run(`UPDATE users
                    SET branch = department
                    WHERE TRIM(COALESCE(branch, '')) = ''
                      AND TRIM(COALESCE(department, '')) != ''`, () => {});

            // ==========================================
            // 1.5. ROLE-SPLIT TABLES (student + faculty)
            // Keeps existing logic stable by syncing from users.
            // superadmin stays out of these tables by design.
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS student (
                id INTEGER PRIMARY KEY,
                role TEXT NOT NULL DEFAULT 'student',
                fullName TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                collegeName TEXT DEFAULT '',
                department TEXT DEFAULT '',
                branch TEXT DEFAULT '',
                program TEXT DEFAULT '',
                year TEXT DEFAULT '',
                section TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                is_verified INTEGER DEFAULT 0,
                isVerified INTEGER DEFAULT 0,
                post TEXT DEFAULT '',
                gender TEXT DEFAULT '',
                mobile TEXT DEFAULT '',
                joiningDate TEXT DEFAULT '',
                course TEXT DEFAULT '',
                subject TEXT DEFAULT '',
                points INTEGER DEFAULT 0,
                solvedCount INTEGER DEFAULT 0,
                rank INTEGER DEFAULT 0,
                is_hod INTEGER DEFAULT 0,
                notif_contest_alerts INTEGER DEFAULT 1,
                notif_submission_results INTEGER DEFAULT 1,
                notif_deadline_reminders INTEGER DEFAULT 1,
                pending_college_name TEXT DEFAULT '',
                college_request_status TEXT DEFAULT '',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) console.error("Error creating student table:", err.message);
            });

            db.run(`CREATE TABLE IF NOT EXISTS faculty (
                id INTEGER PRIMARY KEY,
                role TEXT NOT NULL DEFAULT 'faculty',
                fullName TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                collegeName TEXT DEFAULT '',
                department TEXT DEFAULT '',
                branch TEXT DEFAULT '',
                program TEXT DEFAULT '',
                year TEXT DEFAULT '',
                section TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                is_verified INTEGER DEFAULT 0,
                isVerified INTEGER DEFAULT 0,
                post TEXT DEFAULT '',
                gender TEXT DEFAULT '',
                mobile TEXT DEFAULT '',
                joiningDate TEXT DEFAULT '',
                course TEXT DEFAULT '',
                subject TEXT DEFAULT '',
                points INTEGER DEFAULT 0,
                solvedCount INTEGER DEFAULT 0,
                rank INTEGER DEFAULT 0,
                is_hod INTEGER DEFAULT 0,
                notif_contest_alerts INTEGER DEFAULT 1,
                notif_submission_results INTEGER DEFAULT 1,
                notif_deadline_reminders INTEGER DEFAULT 1,
                pending_college_name TEXT DEFAULT '',
                college_request_status TEXT DEFAULT '',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) console.error("Error creating faculty table:", err.message);
            });

            // Initial backfill from users -> student/faculty
            const mirrorCols = `
                id, role, fullName, email, password, collegeName, department, branch, program, year, section,
                status, is_verified, isVerified, post, gender, mobile, joiningDate, course, subject, points,
                solvedCount, rank, is_hod, notif_contest_alerts, notif_submission_results, notif_deadline_reminders,
                pending_college_name, college_request_status, createdAt
            `;
            db.run(`DELETE FROM student`, (err) => {
                if (err) console.error("Error clearing student split table:", err.message);
            });
            db.run(`DELETE FROM faculty`, (err) => {
                if (err) console.error("Error clearing faculty split table:", err.message);
            });
            db.run(`INSERT OR REPLACE INTO student (${mirrorCols})
                    SELECT ${mirrorCols} FROM users
                    WHERE LOWER(COALESCE(role, '')) IN ('student', 'superadmin')`, (err) => {
                if (err) console.error("Error backfilling student table from users:", err.message);
            });
            db.run(`INSERT OR REPLACE INTO faculty (${mirrorCols})
                    SELECT ${mirrorCols} FROM users
                    WHERE LOWER(COALESCE(role, '')) IN ('faculty', 'hos', 'hod', 'admin')`, (err) => {
                if (err) console.error("Error backfilling faculty table from users:", err.message);
            });

            // Recreate split-sync triggers to keep definition in sync across upgrades.
            db.run(`DROP TRIGGER IF EXISTS trg_users_split_ai`);
            db.run(`DROP TRIGGER IF EXISTS trg_users_split_au`);
            db.run(`DROP TRIGGER IF EXISTS trg_users_split_ad`);
            db.run(`DROP TRIGGER IF EXISTS trg_student_to_users_ai`);
            db.run(`DROP TRIGGER IF EXISTS trg_student_to_users_au`);
            db.run(`DROP TRIGGER IF EXISTS trg_student_to_users_ad`);
            db.run(`DROP TRIGGER IF EXISTS trg_faculty_to_users_ai`);
            db.run(`DROP TRIGGER IF EXISTS trg_faculty_to_users_au`);
            db.run(`DROP TRIGGER IF EXISTS trg_faculty_to_users_ad`);

            // Sync triggers: any users INSERT/UPDATE/DELETE keeps split tables consistent
            db.run(`CREATE TRIGGER IF NOT EXISTS trg_users_split_ai
                    AFTER INSERT ON users
                    BEGIN
                        DELETE FROM student WHERE id = NEW.id;
                        DELETE FROM faculty WHERE id = NEW.id;

                        INSERT INTO student (${mirrorCols})
                        SELECT
                            NEW.id, NEW.role, NEW.fullName, NEW.email, NEW.password, NEW.collegeName,
                            NEW.department, NEW.branch, NEW.program, NEW.year, NEW.section,
                            NEW.status, NEW.is_verified, NEW.isVerified, NEW.post, NEW.gender, NEW.mobile,
                            NEW.joiningDate, NEW.course, NEW.subject, NEW.points, NEW.solvedCount, NEW.rank, NEW.is_hod,
                            NEW.notif_contest_alerts, NEW.notif_submission_results, NEW.notif_deadline_reminders,
                            NEW.pending_college_name, NEW.college_request_status, NEW.createdAt
                        WHERE LOWER(COALESCE(NEW.role, '')) IN ('student', 'superadmin');

                        INSERT INTO faculty (${mirrorCols})
                        SELECT
                            NEW.id, NEW.role, NEW.fullName, NEW.email, NEW.password, NEW.collegeName,
                            NEW.department, NEW.branch, NEW.program, NEW.year, NEW.section,
                            NEW.status, NEW.is_verified, NEW.isVerified, NEW.post, NEW.gender, NEW.mobile,
                            NEW.joiningDate, NEW.course, NEW.subject, NEW.points, NEW.solvedCount, NEW.rank, NEW.is_hod,
                            NEW.notif_contest_alerts, NEW.notif_submission_results, NEW.notif_deadline_reminders,
                            NEW.pending_college_name, NEW.college_request_status, NEW.createdAt
                        WHERE LOWER(COALESCE(NEW.role, '')) IN ('faculty', 'hos', 'hod', 'admin');
                    END`, () => {});

            db.run(`CREATE TRIGGER IF NOT EXISTS trg_users_split_au
                    AFTER UPDATE ON users
                    BEGIN
                        DELETE FROM student WHERE id = NEW.id;
                        DELETE FROM faculty WHERE id = NEW.id;

                        INSERT INTO student (${mirrorCols})
                        SELECT
                            NEW.id, NEW.role, NEW.fullName, NEW.email, NEW.password, NEW.collegeName,
                            NEW.department, NEW.branch, NEW.program, NEW.year, NEW.section,
                            NEW.status, NEW.is_verified, NEW.isVerified, NEW.post, NEW.gender, NEW.mobile,
                            NEW.joiningDate, NEW.course, NEW.subject, NEW.points, NEW.solvedCount, NEW.rank, NEW.is_hod,
                            NEW.notif_contest_alerts, NEW.notif_submission_results, NEW.notif_deadline_reminders,
                            NEW.pending_college_name, NEW.college_request_status, NEW.createdAt
                        WHERE LOWER(COALESCE(NEW.role, '')) IN ('student', 'superadmin');

                        INSERT INTO faculty (${mirrorCols})
                        SELECT
                            NEW.id, NEW.role, NEW.fullName, NEW.email, NEW.password, NEW.collegeName,
                            NEW.department, NEW.branch, NEW.program, NEW.year, NEW.section,
                            NEW.status, NEW.is_verified, NEW.isVerified, NEW.post, NEW.gender, NEW.mobile,
                            NEW.joiningDate, NEW.course, NEW.subject, NEW.points, NEW.solvedCount, NEW.rank, NEW.is_hod,
                            NEW.notif_contest_alerts, NEW.notif_submission_results, NEW.notif_deadline_reminders,
                            NEW.pending_college_name, NEW.college_request_status, NEW.createdAt
                        WHERE LOWER(COALESCE(NEW.role, '')) IN ('faculty', 'hos', 'hod', 'admin');
                    END`, () => {});

            db.run(`CREATE TRIGGER IF NOT EXISTS trg_users_split_ad
                    AFTER DELETE ON users
                    BEGIN
                        DELETE FROM student WHERE id = OLD.id;
                        DELETE FROM faculty WHERE id = OLD.id;
                    END`, () => {});

            // Reverse sync triggers: keep users table compatible when routes write to split tables.
            db.run(`CREATE TRIGGER IF NOT EXISTS trg_student_to_users_ai
                    AFTER INSERT ON student
                    BEGIN
                        INSERT OR REPLACE INTO users (${mirrorCols})
                        VALUES (
                            NEW.id, NEW.role, NEW.fullName, NEW.email, NEW.password, NEW.collegeName,
                            NEW.department, NEW.branch, NEW.program, NEW.year, NEW.section,
                            NEW.status, NEW.is_verified, NEW.isVerified, NEW.post, NEW.gender, NEW.mobile,
                            NEW.joiningDate, NEW.course, NEW.subject, NEW.points, NEW.solvedCount, NEW.rank, NEW.is_hod,
                            NEW.notif_contest_alerts, NEW.notif_submission_results, NEW.notif_deadline_reminders,
                            NEW.pending_college_name, NEW.college_request_status, NEW.createdAt
                        );
                    END`, () => {});

            db.run(`CREATE TRIGGER IF NOT EXISTS trg_student_to_users_au
                    AFTER UPDATE ON student
                    BEGIN
                        UPDATE users
                        SET
                            role = NEW.role,
                            fullName = NEW.fullName,
                            email = NEW.email,
                            password = NEW.password,
                            collegeName = NEW.collegeName,
                            department = NEW.department,
                            branch = NEW.branch,
                            program = NEW.program,
                            year = NEW.year,
                            section = NEW.section,
                            status = NEW.status,
                            is_verified = NEW.is_verified,
                            isVerified = NEW.isVerified,
                            post = NEW.post,
                            gender = NEW.gender,
                            mobile = NEW.mobile,
                            joiningDate = NEW.joiningDate,
                            course = NEW.course,
                            subject = NEW.subject,
                            points = NEW.points,
                            solvedCount = NEW.solvedCount,
                            rank = NEW.rank,
                            is_hod = NEW.is_hod,
                            notif_contest_alerts = NEW.notif_contest_alerts,
                            notif_submission_results = NEW.notif_submission_results,
                            notif_deadline_reminders = NEW.notif_deadline_reminders,
                            pending_college_name = NEW.pending_college_name,
                            college_request_status = NEW.college_request_status,
                            createdAt = NEW.createdAt
                        WHERE id = NEW.id;
                    END`, () => {});


            db.run(`CREATE TRIGGER IF NOT EXISTS trg_faculty_to_users_ai
                    AFTER INSERT ON faculty
                    BEGIN
                        INSERT OR REPLACE INTO users (${mirrorCols})
                        VALUES (
                            NEW.id, NEW.role, NEW.fullName, NEW.email, NEW.password, NEW.collegeName,
                            NEW.department, NEW.branch, NEW.program, NEW.year, NEW.section,
                            NEW.status, NEW.is_verified, NEW.isVerified, NEW.post, NEW.gender, NEW.mobile,
                            NEW.joiningDate, NEW.course, NEW.subject, NEW.points, NEW.solvedCount, NEW.rank, NEW.is_hod,
                            NEW.notif_contest_alerts, NEW.notif_submission_results, NEW.notif_deadline_reminders,
                            NEW.pending_college_name, NEW.college_request_status, NEW.createdAt
                        );
                    END`, () => {});

            db.run(`CREATE TRIGGER IF NOT EXISTS trg_faculty_to_users_au
                    AFTER UPDATE ON faculty
                    BEGIN
                        UPDATE users
                        SET
                            role = NEW.role,
                            fullName = NEW.fullName,
                            email = NEW.email,
                            password = NEW.password,
                            collegeName = NEW.collegeName,
                            department = NEW.department,
                            branch = NEW.branch,
                            program = NEW.program,
                            year = NEW.year,
                            section = NEW.section,
                            status = NEW.status,
                            is_verified = NEW.is_verified,
                            isVerified = NEW.isVerified,
                            post = NEW.post,
                            gender = NEW.gender,
                            mobile = NEW.mobile,
                            joiningDate = NEW.joiningDate,
                            course = NEW.course,
                            subject = NEW.subject,
                            points = NEW.points,
                            solvedCount = NEW.solvedCount,
                            rank = NEW.rank,
                            is_hod = NEW.is_hod,
                            notif_contest_alerts = NEW.notif_contest_alerts,
                            notif_submission_results = NEW.notif_submission_results,
                            notif_deadline_reminders = NEW.notif_deadline_reminders,
                            pending_college_name = NEW.pending_college_name,
                            college_request_status = NEW.college_request_status,
                            createdAt = NEW.createdAt
                        WHERE id = NEW.id;
                    END`, () => {});

            // ==========================================
            // 1.6. UNIFIED ACCOUNT VIEW FOR ROUTES
            // ==========================================
            // Routes now query account_users (not users). Keep IDs globally stable by
            // exposing users as the canonical writable source.
            db.run(`DROP VIEW IF EXISTS account_users`);
            db.run(`CREATE VIEW account_users AS
                    SELECT * FROM users`, () => {});

            db.run(`DROP TRIGGER IF EXISTS trg_account_users_insert`);
            db.run(`DROP TRIGGER IF EXISTS trg_account_users_update`);
            db.run(`DROP TRIGGER IF EXISTS trg_account_users_delete`);

            db.run(`CREATE TRIGGER IF NOT EXISTS trg_account_users_insert
                    INSTEAD OF INSERT ON account_users
                    BEGIN
                        INSERT INTO users (
                            role, fullName, email, password, collegeName, department, branch, program, year, section,
                            status, is_verified, isVerified, post, gender, mobile, joiningDate, course, subject, points,
                            solvedCount, rank, is_hod, notif_contest_alerts, notif_submission_results, notif_deadline_reminders,
                            pending_college_name, college_request_status, createdAt
                        ) VALUES (
                            COALESCE(NEW.role, 'student'), NEW.fullName, NEW.email, NEW.password, NEW.collegeName,
                            NEW.department, NEW.branch, NEW.program, NEW.year, NEW.section,
                            COALESCE(NEW.status, 'pending'), COALESCE(NEW.is_verified, 0), COALESCE(NEW.isVerified, 0),
                            NEW.post, NEW.gender, NEW.mobile, NEW.joiningDate, NEW.course, NEW.subject, COALESCE(NEW.points, 0),
                            COALESCE(NEW.solvedCount, 0), COALESCE(NEW.rank, 0), COALESCE(NEW.is_hod, 0),
                            COALESCE(NEW.notif_contest_alerts, 1), COALESCE(NEW.notif_submission_results, 1), COALESCE(NEW.notif_deadline_reminders, 1),
                            NEW.pending_college_name, NEW.college_request_status, COALESCE(NEW.createdAt, CURRENT_TIMESTAMP)
                        );
                    END`, () => {});

            db.run(`CREATE TRIGGER IF NOT EXISTS trg_account_users_update
                    INSTEAD OF UPDATE ON account_users
                    BEGIN
                        UPDATE users
                        SET
                            role = NEW.role,
                            fullName = NEW.fullName,
                            email = NEW.email,
                            password = NEW.password,
                            collegeName = NEW.collegeName,
                            department = NEW.department,
                            branch = NEW.branch,
                            program = NEW.program,
                            year = NEW.year,
                            section = NEW.section,
                            status = NEW.status,
                            is_verified = NEW.is_verified,
                            isVerified = NEW.isVerified,
                            post = NEW.post,
                            gender = NEW.gender,
                            mobile = NEW.mobile,
                            joiningDate = NEW.joiningDate,
                            course = NEW.course,
                            subject = NEW.subject,
                            points = NEW.points,
                            solvedCount = NEW.solvedCount,
                            rank = NEW.rank,
                            is_hod = NEW.is_hod,
                            notif_contest_alerts = NEW.notif_contest_alerts,
                            notif_submission_results = NEW.notif_submission_results,
                            notif_deadline_reminders = NEW.notif_deadline_reminders,
                            pending_college_name = NEW.pending_college_name,
                            college_request_status = NEW.college_request_status
                        WHERE id = OLD.id;
                    END`, () => {});

            db.run(`CREATE TRIGGER IF NOT EXISTS trg_account_users_delete
                    INSTEAD OF DELETE ON account_users
                    BEGIN
                        DELETE FROM users WHERE id = OLD.id;
                    END`, () => {});


            // ==========================================
            // 2. ASSIGNMENTS TABLES (SPLIT)
            // ==========================================
            // Stores assignments with role-specific foreign keys.
            db.run(`CREATE TABLE IF NOT EXISTS faculty_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subject TEXT NOT NULL,
                year TEXT NOT NULL,
                section TEXT NOT NULL,
                collegeName TEXT DEFAULT '',
                assigned_by_id INTEGER,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES faculty(id) ON DELETE CASCADE,
                FOREIGN KEY(assigned_by_id) REFERENCES faculty(id) ON DELETE SET NULL
            )`, (err) => {
                if (err) console.error("Error creating faculty_assignments table:", err.message);
            });
            db.run(`CREATE INDEX IF NOT EXISTS idx_faculty_assignments_user ON faculty_assignments(user_id)`, () => {});
            db.run(`CREATE INDEX IF NOT EXISTS idx_faculty_assignments_college ON faculty_assignments(collegeName)`, () => {});

            db.run(`CREATE TABLE IF NOT EXISTS student_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subject TEXT NOT NULL,
                year TEXT NOT NULL,
                section TEXT NOT NULL,
                collegeName TEXT DEFAULT '',
                assigned_by_id INTEGER,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES student(id) ON DELETE CASCADE,
                FOREIGN KEY(assigned_by_id) REFERENCES faculty(id) ON DELETE SET NULL
            )`, (err) => {
                if (err) console.error("Error creating student_assignments table:", err.message);
            });
            db.run(`CREATE INDEX IF NOT EXISTS idx_student_assignments_user ON student_assignments(user_id)`, () => {});
            db.run(`CREATE INDEX IF NOT EXISTS idx_student_assignments_college ON student_assignments(collegeName)`, () => {});

            // Migrate legacy assignment rows into split tables if the old table exists.
            db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_assignments'`, [], (legacyErr, legacyRow) => {
                if (legacyErr) {
                    console.error("Error checking legacy user_assignments table:", legacyErr.message);
                    return;
                }
                if (!legacyRow) return;

                db.run(`INSERT OR IGNORE INTO faculty_assignments (id, user_id, subject, year, section, collegeName, assigned_by_id, createdAt)
                        SELECT ua.id, ua.user_id, ua.subject, ua.year, ua.section, COALESCE(ua.collegeName, ''), ua.assigned_by_id, ua.createdAt
                        FROM user_assignments ua
                        JOIN faculty f ON f.id = ua.user_id`, () => {});

                db.run(`INSERT OR IGNORE INTO student_assignments (id, user_id, subject, year, section, collegeName, assigned_by_id, createdAt)
                        SELECT ua.id, ua.user_id, ua.subject, ua.year, ua.section, COALESCE(ua.collegeName, ''), ua.assigned_by_id, ua.createdAt
                        FROM user_assignments ua
                        JOIN student s ON s.id = ua.user_id`, () => {});

                db.run(`DROP TABLE IF EXISTS user_assignments`, () => {});
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
                    { name: 'hod_verified', type: 'INTEGER DEFAULT 0' },
                    { name: 'points', type: 'INTEGER DEFAULT 50' },
                    { name: 'tags', type: 'TEXT DEFAULT \'\'' },
                    { name: 'scope', type: 'TEXT DEFAULT \'global\'' },
                    { name: 'created_by', type: 'INTEGER' },
                    { name: 'approved_by', type: 'INTEGER' },
                    { name: 'approved_at', type: 'DATETIME' }
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
                    { name: 'registrationEndDate', type: 'TEXT' },
                    { name: 'duration', type: 'TEXT' },
                    { name: 'eligibility', type: 'TEXT' },
                    { name: 'description', type: 'TEXT' },
                    { name: 'rulesAndDescription', type: 'TEXT' },
                    { name: 'guidelines', type: 'TEXT DEFAULT \'\'' },
                    { name: 'colleges', type: 'TEXT DEFAULT \'[]\'' },
                    { name: 'problems', type: 'TEXT DEFAULT \'[]\'' },
                    { name: 'contest_class', type: 'TEXT DEFAULT \'E\'' },
                    { name: 'prize', type: 'TEXT DEFAULT \'\'' },
                    { name: 'hos_verified', type: 'INTEGER DEFAULT 0' },
                    { name: 'hod_verified', type: 'INTEGER DEFAULT 0' },
                    { name: 'collegeName', type: 'TEXT DEFAULT \'\'' },
                    { name: 'approved_by', type: 'INTEGER' },
                    { name: 'approved_at', type: 'DATETIME' },
                    { name: 'is_live', type: 'INTEGER DEFAULT 0' },
                    { name: 'live_mode', type: 'TEXT DEFAULT \'all_students\'' },
                    { name: 'live_user_ids', type: 'TEXT DEFAULT \'[]\'' },
                    { name: 'live_at', type: 'DATETIME' }
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
            // 6.6. PROBLEM BOOKMARKS TABLE
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS problem_bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                problem_id INTEGER NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, problem_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(problem_id) REFERENCES problems(id) ON DELETE CASCADE
            )`, (err) => {
                if (err) console.error("Error creating problem_bookmarks table:", err.message);
            });

            // ==========================================
            // 7. ACADEMIC ERP TABLES (Merged and Fixed)
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

            // Fixed: Sections now properly uses year while maintaining old capacity/semester columns
            db.run(`CREATE TABLE IF NOT EXISTS sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                year INTEGER NOT NULL,
                semester INTEGER, 
                capacity INTEGER,
                collegeName TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )`, (err) => {
                if (err) console.error("Error creating sections table:", err.message);
            });

            // ⭐ FIXED: Removed NOT NULL constraints for year and semester
            db.run(`CREATE TABLE IF NOT EXISTS subjects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch_id INTEGER NOT NULL,
                section_id INTEGER, 
                name TEXT NOT NULL,
                code TEXT NOT NULL,
                credits INTEGER,
                year INTEGER,
                semester INTEGER,
                collegeName TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE CASCADE
            )`, (err) => {
                if (err) console.error("Error creating subjects table:", err.message);
            });

            // ==========================================
            // 8. FORUM TABLES
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS forum_threads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                topic TEXT DEFAULT 'general',
                user_id INTEGER NOT NULL,
                collegeName TEXT DEFAULT '',
                views INTEGER DEFAULT 0,
                upvotes INTEGER DEFAULT 0,
                downvotes INTEGER DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )`, (err) => {
                if (err) console.error("Error creating forum_threads table:", err.message);
            });

            db.all(`PRAGMA table_info(forum_threads)`, (err, columns) => {
                if (err) return;
                const columnNames = columns.map(col => col.name);
                if (!columnNames.includes('upvotes')) {
                    db.run(`ALTER TABLE forum_threads ADD COLUMN upvotes INTEGER DEFAULT 0`);
                }
                if (!columnNames.includes('downvotes')) {
                    db.run(`ALTER TABLE forum_threads ADD COLUMN downvotes INTEGER DEFAULT 0`);
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS forum_replies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                upvotes INTEGER DEFAULT 0,
                downvotes INTEGER DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )`, (err) => {
                if (err) console.error("Error creating forum_replies table:", err.message);
            });

            db.run(`CREATE TABLE IF NOT EXISTS forum_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reply_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                vote_type INTEGER NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(reply_id) REFERENCES forum_replies(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(reply_id, user_id)
            )`, (err) => {
                if (err) console.error("Error creating forum_votes table:", err.message);
            });

            db.run(`CREATE TABLE IF NOT EXISTS forum_thread_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                vote_type INTEGER NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(thread_id, user_id)
            )`, (err) => {
                if (err) console.error("Error creating forum_thread_votes table:", err.message);
            });

            // ==========================================
            // 10. SUBMISSIONS TABLE
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                problem_id INTEGER NOT NULL,
                contest_id INTEGER,
                user_id INTEGER NOT NULL,
                language TEXT NOT NULL,
                code TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                result_details TEXT DEFAULT '[]',
                points_earned INTEGER DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(problem_id) REFERENCES problems(id) ON DELETE CASCADE,
                FOREIGN KEY(contest_id) REFERENCES contests(id) ON DELETE SET NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )`, (err) => {
                if (err) console.error("Error creating submissions table:", err.message);
                db.run(`ALTER TABLE submissions ADD COLUMN contest_id INTEGER`, () => {});
            });

            // ==========================================
            // 10.5 CONTEST PARTICIPANTS TABLE
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS contest_participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contest_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(contest_id, user_id),
                FOREIGN KEY(contest_id) REFERENCES contests(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )`, (err) => {
                if (err) console.error("Error creating contest_participants table:", err.message);
            });

            // Backfill legacy superadmin contests as global + auto-approved
            db.run(`
                UPDATE contests
                SET
                    visibility_scope = 'global',
                    scope = 'global',
                    level = 'global',
                    status = CASE WHEN LOWER(COALESCE(status, '')) = 'upcoming' THEN status ELSE 'accepted' END,
                    isVerified = 1,
                    approved_by = COALESCE(approved_by, createdBy),
                    approved_at = COALESCE(approved_at, createdAt)
                WHERE createdBy IN (SELECT id FROM users WHERE role = 'superadmin')
            `, () => {});

            // Normalize non-superadmin college-module contests away from global defaults
            db.run(`
                UPDATE contests
                SET
                    visibility_scope = CASE WHEN LOWER(COALESCE(visibility_scope, '')) = 'global' THEN 'college' ELSE COALESCE(visibility_scope, 'college') END,
                    scope = CASE WHEN LOWER(COALESCE(scope, '')) = 'global' THEN 'college' ELSE COALESCE(scope, 'college') END,
                    level = CASE WHEN LOWER(COALESCE(level, '')) = 'global' THEN 'college' ELSE COALESCE(level, 'college') END
                WHERE createdBy NOT IN (SELECT id FROM users WHERE role = 'superadmin')
            `, () => {});

            // ==========================================
            // 11. SUPPORT TICKETS TABLE
            // ==========================================
            db.run(`CREATE TABLE IF NOT EXISTS support_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                requester_name TEXT NOT NULL,
                requester_email TEXT NOT NULL,
                requester_role TEXT NOT NULL,
                requester_college TEXT DEFAULT '',
                subject TEXT NOT NULL,
                category TEXT DEFAULT 'General Question',
                details TEXT NOT NULL,
                status TEXT DEFAULT 'open',
                superadmin_reply TEXT DEFAULT '',
                resolved_by INTEGER,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(resolved_by) REFERENCES users(id) ON DELETE SET NULL
            )`, (err) => {
                if (err) console.error("Error creating support_tickets table:", err.message);
            });

            // ==========================================
            // 9. DEFAULT SUPERADMIN ACCOUNT
            // ==========================================
            // Insert the default SuperAdmin if it doesn't already exist
            const superAdminEmail = 'super@campuscode.com';
            const superAdminPlainPassword = 'super123'; // Change this in production!

            db.get(`SELECT * FROM users WHERE email = ?`, [superAdminEmail], (err, row) => {
                if (err) {
                    console.error("Error checking for default superadmin:", err.message);
                } else if (!row) {
                    // ⭐ Securely hash the default password before saving it
                    bcrypt.hash(superAdminPlainPassword, 10, (hashErr, hashedPassword) => {
                        if (hashErr) {
                            console.error("Error hashing superadmin password:", hashErr.message);
                            return;
                        }

                        db.run(`INSERT INTO users (role, fullName, email, password, status) 
                                VALUES ('superadmin', 'Platform Admin', ?, ?, 'active')`, 
                            [superAdminEmail, hashedPassword], 
                            (err) => {
                                if (err) console.error("Error inserting default superadmin:", err.message);
                                else console.log("✅ Default SuperAdmin account securely created.");
                            }
                        );
                    });
                }
            });
        });
    }
});

// Export the database instance so other files can use it
module.exports = db;
