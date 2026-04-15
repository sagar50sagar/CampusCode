const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const { requireRole } = require('../middleware/auth');

// ⭐ In-memory store for OTPs (email -> { otp, expiresAt })
const otpStore = new Map();

// ⭐ Helper function to check for existing HOD using 'branch'
const checkHODExists = (db, collegeName, branch, excludeUserId = null) => {
    return new Promise((resolve, reject) => {
        let query = `SELECT id FROM users WHERE collegeName = ? AND branch = ? AND is_hod = 1 AND status = 'active'`;
        let params = [collegeName, branch];
        
        if (excludeUserId) {
            query += ` AND id != ?`;
            params.push(excludeUserId);
        }

        db.get(query, params, (err, row) => {
            if (err) reject(err);
            resolve(row ? true : false);
        });
    });
};

module.exports = (db, transporter) => {
    const router = express.Router();

    const dbAllAsync = (query, params = []) => new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });

    const dbGetAsync = (query, params = []) => new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });

    const calculateConsecutiveDayStreak = (dateValues = []) => {
        const normalizedDates = [...new Set(
            dateValues
                .map((value) => String(value || '').trim().slice(0, 10))
                .filter(Boolean)
        )].sort((a, b) => b.localeCompare(a));

        if (!normalizedDates.length) return 0;

        let streak = 1;
        for (let index = 1; index < normalizedDates.length; index += 1) {
            const previous = new Date(`${normalizedDates[index - 1]}T00:00:00Z`);
            const current = new Date(`${normalizedDates[index]}T00:00:00Z`);
            const diffDays = Math.round((previous.getTime() - current.getTime()) / 86400000);
            if (diffDays !== 1) break;
            streak += 1;
        }

        return streak;
    };

    const buildRankMap = (entries = []) => {
        const sorted = [...entries].sort((a, b) => {
            const pointDiff = Number(b.points || 0) - Number(a.points || 0);
            if (pointDiff !== 0) return pointDiff;
            return Number(a.id || 0) - Number(b.id || 0);
        });

        const rankMap = new Map();
        let lastPoints = null;
        let currentRank = 0;

        sorted.forEach((entry, index) => {
            const points = Number(entry.points || 0);
            if (lastPoints === null || points !== lastPoints) {
                currentRank = index + 1;
                lastPoints = points;
            }
            rankMap.set(Number(entry.id), `#${currentRank}`);
        });

        return rankMap;
    };

    const normalizeEntityCode = (value) => String(value || '').trim().toUpperCase();

    const ensureUniqueAcademicCode = async ({ table, code, collegeName, excludeId = null }) => {
        const normalizedCode = normalizeEntityCode(code);
        if (!normalizedCode) return null;

        let query = `SELECT id FROM ${table} WHERE collegeName = ? AND UPPER(TRIM(code)) = ?`;
        const params = [collegeName, normalizedCode];

        if (excludeId) {
            query += ` AND id != ?`;
            params.push(excludeId);
        }

        return dbGetAsync(query, params);
    };

    const normalizeLookupValue = (value) => String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

    const normalizeYearValue = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const numericMatch = raw.match(/\d+/);
        return numericMatch ? String(parseInt(numericMatch[0], 10)) : normalizeLookupValue(raw);
    };

    const getAcademicStructure = async (collegeName) => {
        const [programs, branches, sections] = await Promise.all([
            dbAllAsync(`SELECT * FROM programs WHERE collegeName = ? OR collegeName IS NULL`, [collegeName]),
            dbAllAsync(`
                SELECT b.*, p.name as program_name, p.duration as program_duration
                FROM branches b
                JOIN programs p ON b.program_id = p.id
                WHERE p.collegeName = ? OR p.collegeName IS NULL
            `, [collegeName]),
            dbAllAsync(`
                SELECT s.*, b.name as branch_name, b.abbreviation as branch_abbreviation, p.name as program_name, p.duration as program_duration
                FROM sections s
                JOIN branches b ON s.branch_id = b.id
                JOIN programs p ON b.program_id = p.id
                WHERE (p.collegeName = ? OR p.collegeName IS NULL) AND (s.collegeName = ? OR s.collegeName IS NULL)
            `, [collegeName, collegeName])
        ]);

        return { programs, branches, sections };
    };

    const resolveAcademicFields = async (collegeName, user = {}) => {
        const structure = await getAcademicStructure(collegeName);
        const role = String(user.role || '').toLowerCase();

        const rawProgram = String(user.program || user.course || '').trim();
        const rawBranch = String(user.branch || user.department || '').trim();
        const rawSection = String(user.section || '').trim();
        const rawYear = String(user.year || '').trim();

        const normalizedProgram = normalizeLookupValue(rawProgram);
        const normalizedBranch = normalizeLookupValue(rawBranch);
        const normalizedSection = normalizeLookupValue(rawSection);
        const normalizedYear = normalizeYearValue(rawYear);

        let matchedProgram = null;
        if (normalizedProgram) {
            matchedProgram = structure.programs.find(program =>
                normalizeLookupValue(program.name) === normalizedProgram ||
                normalizeLookupValue(program.code) === normalizedProgram
            ) || null;
        }

        let matchedBranch = null;
        if (normalizedBranch) {
            matchedBranch = structure.branches.find(branch => {
                const sameProgram = !matchedProgram || Number(branch.program_id) === Number(matchedProgram.id);
                return sameProgram && (
                    normalizeLookupValue(branch.name) === normalizedBranch ||
                    normalizeLookupValue(branch.abbreviation) === normalizedBranch ||
                    normalizeLookupValue(branch.code) === normalizedBranch
                );
            }) || null;
        }

        if (!matchedBranch && matchedProgram && structure.branches.length === 1) {
            matchedBranch = structure.branches.find(branch => Number(branch.program_id) === Number(matchedProgram.id)) || null;
        }

        let matchedSections = matchedBranch
            ? structure.sections.filter(section => Number(section.branch_id) === Number(matchedBranch.id))
            : [];

        let matchedSection = null;
        if (normalizedSection && matchedSections.length > 0) {
            matchedSection = matchedSections.find(section =>
                normalizeLookupValue(section.name) === normalizedSection
            ) || null;
        }

        if (!matchedSection && normalizedYear && matchedSections.length > 0) {
            const sameYearSections = matchedSections.filter(section => normalizeYearValue(section.year) === normalizedYear);
            if (sameYearSections.length === 1) {
                matchedSection = sameYearSections[0];
            }
        }

        if (!matchedProgram && matchedBranch) {
            matchedProgram = structure.programs.find(program => Number(program.id) === Number(matchedBranch.program_id)) || null;
        }

        const finalProgram = matchedProgram ? matchedProgram.name : rawProgram;
        const finalBranch = matchedBranch ? matchedBranch.name : rawBranch;
        const finalDepartment = finalBranch || rawBranch || '';
        const finalSection = matchedSection ? matchedSection.name : rawSection;
        const finalYear = matchedSection
            ? String(matchedSection.year || '')
            : (normalizedYear ? rawYear || normalizedYear : '');

        if (role !== 'student') {
            return {
                program: finalProgram || '',
                course: finalProgram || '',
                branch: finalBranch || '',
                department: finalDepartment || '',
                year: '',
                section: ''
            };
        }

        return {
            program: finalProgram || '',
            course: finalProgram || '',
            branch: finalBranch || '',
            department: finalDepartment || '',
            year: finalYear || '',
            section: finalSection || ''
        };
    };

    // ==========================================
    // ==========================================
    // ⭐ METADATA API (Strictly DB Connected - NO HARDCODING)
    // ==========================================
    router.get('/api/metadata', (req, res) => {
        // Get the current logged-in user's college
        const collegeName = req.session && req.session.user ? req.session.user.collegeName : null;

        // Fetch branches strictly for this college (or global null ones)
        db.all(`SELECT name, abbreviation FROM branches WHERE collegeName = ? OR collegeName IS NULL GROUP BY name`, [collegeName], (errDept, deptRows) => {
            let departments = []; 
            if (!errDept && deptRows && deptRows.length > 0) {
                // Map to an object containing both name and abbreviation
                departments = deptRows.map(row => ({ name: row.name, abbr: row.abbreviation }));
            }

            // Fetch designations strictly for this college
            db.all(`SELECT DISTINCT designation FROM users WHERE designation IS NOT NULL AND designation != '' AND collegeName = ?`, [collegeName], (errDesig, desigRows) => {
                let designations = []; 
                if (!errDesig && desigRows && desigRows.length > 0) {
                    designations = desigRows.map(row => row.designation);
                }

                // Dynamically fetch available programs specifically for THIS college
                db.all(`SELECT DISTINCT name FROM programs WHERE collegeName = ? OR collegeName IS NULL`, [collegeName], (errProg, progRows) => {
                    let programs = [];
                    if (!errProg && progRows && progRows.length > 0) {
                        programs = progRows.map(row => row.name);
                    }

                    res.json({ success: true, departments, designations, programs });
                });
            });
        });
    });

    // ==========================================
    // DASHBOARD VIEWS (Clean URLs)
    // ==========================================
    router.get('/dashboard', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/dashboard.html'));
    });

    router.get('/program', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/program.html'));
    });

    router.get('/contest', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/contest.html'));
    });

    router.get('/manage_user', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/manage_user.html'));
    });

    router.get('/manage-users', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/manage_user.html'));
    });

    router.get('/report', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/report.html'));
    });

    router.get('/setting', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/setting.html'));
    });

    router.get('/profile', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/profile.html'));
    });
    router.get('/forgot-password', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/forgot-password.html'));
    });

    router.get('/help_support', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/help_support.html'));
    });

    router.get('/view_faculty', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/faculty/view_faculty.html'));
    });
    
    router.get('/view_student', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/student/view_student.html'));
    });

    // Serve community/forum for admin from admin views
    router.get('/community', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/community-forum.html'));
    });
    // ==========================================
    // SERVE THREAD DETAILS PAGE
    // ==========================================
    router.get('/forum/thread/:id', requireRole('admin'), (req, res) => {
        // This will serve the thread.html file from your views folder
        res.sendFile(path.join(__dirname, '../views/admin/thread.html'));
    });
    router.get('/thread.html', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/thread.html'));
    });
    router.get('/thread', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/thread.html'));
    });
// ==========================================
    // 1. ADD THIS: Bulk Approve Users API
    // ==========================================
    router.post('/bulk-approve', requireRole('admin'), (req, res) => {
        const { userIds } = req.body;
        if (!userIds || !userIds.length) {
            return res.status(400).json({ success: false, message: "No users selected" });
        }

        try {
            // Create placeholders for the SQL query based on the number of IDs
            const placeholders = userIds.map(() => '?').join(',');
            const query = `UPDATE users SET status = 'active' WHERE id IN (${placeholders}) AND status = 'pending'`;
            
            db.run(query, userIds, function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, message: "Selected users approved successfully!" });
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ==========================================
    // 2. ADD THIS: Real-time Stats API (Active, Ranks)
    // ==========================================
    router.get('/stats', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;

        db.all(`
            SELECT
                LOWER(TRIM(COALESCE(collegeName, ''))) AS normalizedCollege,
                COUNT(*) AS activeCount,
                COALESCE(SUM(CASE WHEN LOWER(COALESCE(role, '')) = 'student' THEN COALESCE(points, 0) ELSE 0 END), 0) AS totalPoints
            FROM users
            WHERE status = 'active'
              AND TRIM(COALESCE(collegeName, '')) != ''
            GROUP BY LOWER(TRIM(COALESCE(collegeName, '')))
            ORDER BY totalPoints DESC, activeCount DESC
        `, [], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });

            const normalizedCollege = String(collegeName || '').trim().toLowerCase();
            const ordered = rows || [];
            const currentIndex = ordered.findIndex((row) => row.normalizedCollege === normalizedCollege);
            const currentCollege = currentIndex >= 0 ? ordered[currentIndex] : null;

            res.json({
                success: true,
                activeUsers: Number(currentCollege?.activeCount || 0),
                collegeRank: currentIndex >= 0 ? `#${currentIndex + 1}` : '-',
                globalRank: currentIndex >= 0 ? `#${currentIndex + 1}` : '-'
            });
        });
    });

    // ==========================================
    // SMART ALIAS ROUTES (.html extensions)
    // ==========================================
    router.get('/dashboard.html', requireRole('admin'), (req, res) => res.redirect('/college/dashboard'));
    router.get('/program.html', requireRole('admin'), (req, res) => res.redirect('/college/program'));
    router.get('/contest.html', requireRole('admin'), (req, res) => res.redirect('/college/contest'));
    router.get('/manage_user.html', requireRole('admin'), (req, res) => res.redirect('/college/manage_user'));
    router.get('/manage-users.html', requireRole('admin'), (req, res) => res.redirect('/college/manage-users'));
    router.get('/report.html', requireRole('admin'), (req, res) => res.redirect('/college/report'));
    router.get('/setting.html', requireRole('admin'), (req, res) => res.redirect('/college/setting'));
    router.get('/profile.html', requireRole('admin'), (req, res) => res.redirect('/college/profile'));
    router.get('/help_support.html', requireRole('admin'), (req, res) => res.redirect('/college/help_support'));
    router.get('/help-support', requireRole('admin'), (req, res) => res.redirect('/college/help_support'));
    router.get('/help-support.html', requireRole('admin'), (req, res) => res.redirect('/college/help_support'));
    router.get('/view_student.html', requireRole('admin'), (req, res) => res.redirect('/college/view_student'));
    router.get('/forgot-password.html', requireRole('admin'), (req, res) => res.redirect('/college/forgot-password'));
   router.get('/community.html', requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, '../public/forum.html'));
});

    // ==========================================
    // LOGOUT API 
    // ==========================================
    router.post('/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ success: false, message: 'Logout failed' });
            res.clearCookie('connect.sid'); 
            res.json({ success: true, message: 'Logged out successfully' });
        });
    });
// ==========================================
    // ⭐ SETTINGS & PROFILE APIs
    // ==========================================
    router.get('/api/profile', requireRole('admin'), (req, res) => {
        const userId = req.session.user.id;
        db.get(`
            SELECT u.*, COALESCE(c.university, '') AS university, COALESCE(c.accreditation, '') AS accreditation
            FROM users u
            LEFT JOIN colleges c ON LOWER(TRIM(COALESCE(c.name, ''))) = LOWER(TRIM(COALESCE(u.collegeName, '')))
            WHERE u.id = ?
        `, [userId], (err, user) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            
            if (user) {
                const parts = (user.fullName || '').split(' ');
                user.firstName = parts[0];
                user.lastName = parts.slice(1).join(' ');
            }
            res.json({ success: true, user });
        });
    });

    // ==========================================
    // ⭐ DASHBOARD DATA API (SAFE VERSION)
    // ==========================================
    router.get('/api/dashboard-data', requireRole('admin'), async (req, res) => {
        const collegeName = req.session.user.collegeName;
        
        try {
            // Helper function to safely query DB without crashing if table is missing
            const safeQuery = (query, params) => new Promise((resolve) => {
                db.all(query, params, (err, rows) => {
                    if (err) {
                        console.error("DB Query Error (Ignored):", err.message);
                        resolve([]); // Return empty array on error
                    } else {
                        resolve(rows);
                    }
                });
            });

            const users = await safeQuery(`SELECT status FROM users WHERE collegeName = ?`, [collegeName]);
            const activeLogins = users.filter(u => u.status === 'active').length;
            const totalUsers = users.length;
            
            // Safe queries for other tables
            const contests = await safeQuery(`
                SELECT c.id
                FROM contests c
                LEFT JOIN account_users cu ON cu.id = c.createdBy
                WHERE LOWER(
                    TRIM(
                        COALESCE(
                            NULLIF(c.collegeName, ''),
                            NULLIF(cu.collegeName, ''),
                            ''
                        )
                    )
                ) = LOWER(TRIM(COALESCE(?, '')))
            `, [collegeName]);
            const feedRows = [];
            
            // 👉 ADDED: Fetch programs count for the dashboard and profile overlay
            const programs = await safeQuery(`SELECT id FROM programs WHERE collegeName = ? OR collegeName IS NULL`, [collegeName]);

            // Removed the system_alerts query to fix the SQLITE_ERROR in the console.

            res.json({
                success: true,
                stats: {
                    totalContests: contests.length,
                    totalUsers: totalUsers,
                    activeLogins: activeLogins,
                    totalPrograms: programs.length // 👉 ADDED: Sending program count to frontend
                },
                activityFeed: feedRows
                // Removed systemAlerts from the JSON response
            });
        } catch (error) {
            console.error("Dashboard Data Error:", error);
            res.status(500).json({ success: false, message: "Internal server error" });
        }
    });

    // ==========================================
    // ⭐ GRAPH API (SAFE VERSION)
    // ==========================================
    router.get('/api/activity-stats', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        
        const query = `
            SELECT strftime('%m', createdAt) as month_num, COUNT(*) as count
            FROM users 
            WHERE collegeName = ? AND createdAt >= date('now', '-6 months')
            GROUP BY month_num ORDER BY createdAt ASC
        `;

        db.all(query, [collegeName], (err, rows) => {
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            
            // Fallback default labels for the last 6 months
            let labels = [];
            let data = [0, 0, 0, 0, 0, 0];
            let d = new Date();
            for (let i = 5; i >= 0; i--) {
                let m = new Date(d.getFullYear(), d.getMonth() - i, 1);
                labels.push(monthNames[m.getMonth()]);
            }

            if (err) {
                console.error("Graph Error (Table might be missing column):", err.message);
                return res.json({ labels, data }); // Send default empty graph so it doesn't break
            }

            if (rows && rows.length > 0) {
                // If we have actual data, overwrite the defaults
                labels = rows.map(r => monthNames[parseInt(r.month_num, 10) - 1] || 'Unknown');
                data = rows.map(r => r.count);
            }

            res.json({ labels, data });
        });
    });
    // ==========================================
    // OTP & PASSWORD APIs
    // ==========================================
    router.post('/send-email-update-otp', requireRole('admin'), (req, res) => {
        const normalizedEmail = String(req.body.email || '').trim().toLowerCase();
        const userId = req.session.user.id;

        if (!normalizedEmail) return res.status(400).json({ success: false, message: "Email is required" });

        db.get(`SELECT email FROM users WHERE id = ?`, [userId], (userErr, currentUser) => {
            if (userErr) return res.status(500).json({ success: false, message: userErr.message });
            if (!currentUser) return res.status(404).json({ success: false, message: "User not found" });
            if (String(currentUser.email || '').trim().toLowerCase() === normalizedEmail) {
                return res.status(400).json({ success: false, message: "This is already your current email address." });
            }

            db.get(`SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id != ?`, [normalizedEmail, userId], (err, existingUser) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (existingUser) {
                    return res.status(400).json({ success: false, message: "Email is already in use by another account." });
                }

                const currentEmail = String(currentUser.email || '').trim().toLowerCase();
                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                otpStore.set(`email_${userId}`, { email: normalizedEmail, otp, expiresAt: Date.now() + 5 * 60 * 1000 });
                
                console.log(`[DEV MODE] Email Update OTP for ${normalizedEmail} sent to current email ${currentEmail}: ${otp}`);
                
                if (transporter) {
                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: currentEmail,
                        subject: 'CampusCode - Email Update OTP',
                        html: `<div style="font-family: sans-serif; padding: 20px;">
                                <h2>Email Update Request</h2>
                                <p>You requested to update your CampusCode login email to <strong>${normalizedEmail}</strong>.</p>
                                <p>Your OTP to verify your new email address is: <strong style="font-size: 24px; color: #1E4A7A;">${otp}</strong></p>
                                <p>This code is valid for 5 minutes.</p>
                            </div>`
                    };
                    transporter.sendMail(mailOptions).catch(err => console.error('Failed to send OTP email:', err));
                }

                res.json({ success: true, message: `OTP sent successfully to your current email: ${currentEmail}` });
            });
        });
    });

    router.post('/verify-email-otp', requireRole('admin'), (req, res) => {
        const email = String(req.body.email || '').trim().toLowerCase();
        const otp = String(req.body.otp || '').trim();
        const userId = req.session.user.id;
        const stored = otpStore.get(`email_${userId}`);

        if (!stored || stored.otp !== otp || stored.expiresAt < Date.now() || stored.email !== email) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        db.get(`SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id != ?`, [email, userId], (lookupErr, existingUser) => {
            if (lookupErr) return res.status(500).json({ success: false, message: lookupErr.message });
            if (existingUser) {
                return res.status(400).json({ success: false, message: "Email is already in use by another account." });
            }

            otpStore.delete(`email_${userId}`);

            db.run(`UPDATE users SET email = ? WHERE id = ?`, [email, userId], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                req.session.user.email = email;
                res.json({ success: true, message: "Email updated successfully" });
            });
        });
    });

    router.post('/forgot-password-otp', requireRole('admin'), (req, res) => {
        const email = req.session.user.email; 
        if (!email) return res.status(400).json({ success: false, message: "No email on record." });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore.set(`fp_${req.session.user.id}`, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
        
        console.log(`[DEV MODE] Forgot Password OTP for ${email}: ${otp}`);
        
        if (transporter) {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'CampusCode - Password Reset OTP',
                html: `<div style="font-family: sans-serif; padding: 20px;">
                        <h2>Password Reset Request</h2>
                        <p>Your OTP to reset your password is: <strong style="font-size: 24px; color: #1E4A7A;">${otp}</strong></p>
                        <p>This code is valid for 5 minutes. If you didn't request this, please ignore this email.</p>
                    </div>`
            };
            transporter.sendMail(mailOptions).catch(err => console.error('Failed to send OTP email:', err));
        }

        res.json({ success: true, message: "OTP sent successfully to your email." });
    });

    router.post('/reset-password', requireRole('admin'), async (req, res) => {
        const { otp, newPassword } = req.body;
        const userId = req.session.user.id;
        const stored = otpStore.get(`fp_${userId}`);

        if (!stored || stored.otp !== otp || stored.expiresAt < Date.now()) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        try {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashedPassword, userId], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                otpStore.delete(`fp_${userId}`); 
                res.json({ success: true, message: "Password reset successfully" });
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

router.post('/update-profile', requireRole('admin'), (req, res) => {
    // 1. We removed 'designation' (and 'post' if it was there) from req.body
    const { fullName, mobile, gender, program, branch, joiningDate } = req.body;
    const userId = req.session.user.id;

    // 2. Remove 'designation = ?' from the SQL query
    const query = `UPDATE users SET fullName = ?, mobile = ?, gender = ?, program = ?, branch = ?, joiningDate = ? WHERE id = ?`;
    
    // 3. Remove the designation variable from the params array
    const params = [fullName, mobile, gender, program, branch, joiningDate, userId];

    db.run(query, params, function(err) {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ success: false, message: err.message });
        }
        
        // Update session info if needed
        if (req.session && req.session.user) {
            req.session.user.fullName = fullName;
            // update other session variables if your app relies on them...
        }
        
        res.json({ success: true, message: "Profile updated successfully" });
    });
});

    // ==========================================
    // ADMIN APIs (Manage Users in their College)
    // ==========================================
    router.get('/api/pending-faculty', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.all(`
            SELECT id, fullName, email, branch, role, 'account' as request_type
            FROM users
            WHERE collegeName = ? AND status = 'pending'
            UNION ALL
            SELECT id, fullName, email, branch, role, 'college_change' as request_type
            FROM users
            WHERE role = 'student' AND pending_college_name = ? AND college_request_status = 'pending'
        `, 
        [collegeName, collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, pending: rows });
        });
    });

    const approvePendingUser = async ({ userId, collegeName, course = null, branch = null, role = null }) => {
        const userRow = await dbGetAsync(
            `SELECT id, role, status, collegeName, pending_college_name, college_request_status, program, course, branch
             FROM users WHERE id = ?`,
            [userId]
        );

        if (!userRow) {
            return { success: false, status: 404, error: 'User not found.' };
        }

        const isStudentCollegeRequest = String(userRow.role || '').toLowerCase() === 'student'
            && String(userRow.college_request_status || '').toLowerCase() === 'pending'
            && String(userRow.pending_college_name || '') === String(collegeName || '');

        if (isStudentCollegeRequest) {
            await new Promise((resolve, reject) => {
                db.run(`
                    UPDATE users
                    SET collegeName = pending_college_name,
                        pending_college_name = '',
                        college_request_status = 'approved',
                        status = 'active',
                        is_verified = 1,
                        isVerified = 1
                    WHERE id = ?
                `, [userId], function (approveErr) {
                    if (approveErr) return reject(approveErr);
                    resolve(this);
                });
            });

            return { success: true, message: 'Student college verification approved successfully.' };
        }

        const resolvedCourse = course || userRow.program || userRow.course || '';
        const resolvedBranch = branch || userRow.branch || '';
        const assignedRole = role || null;

        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE users
                 SET status = 'active',
                     is_verified = 1,
                     isVerified = 1,
                     course = COALESCE(NULLIF(?, ''), course),
                     program = COALESCE(NULLIF(?, ''), program),
                     branch = COALESCE(NULLIF(?, ''), branch),
                     department = COALESCE(NULLIF(?, ''), department),
                     role = COALESCE(?, role)
                 WHERE id = ? AND collegeName = ?`,
                [resolvedCourse, resolvedCourse, resolvedBranch, resolvedBranch, assignedRole, userId, collegeName],
                function (err) {
                    if (err) return reject(err);
                    resolve(this);
                }
            );
        });

        return { success: true, message: 'User verified and assigned successfully' };
    };

    router.post('/api/approve-faculty/:id', requireRole('admin'), async (req, res) => {
        try {
            const result = await approvePendingUser({
                userId: req.params.id,
                collegeName: req.session.user.collegeName,
                course: req.body?.course || null,
                branch: req.body?.branch || null,
                role: req.body?.role || null
            });

            if (!result.success) {
                return res.status(result.status || 400).json({ success: false, error: result.error || 'Approval failed.' });
            }

            res.json({ success: true, message: result.message });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/api/pending-faculty/:id/approve', requireRole('admin'), async (req, res) => {
        try {
            const result = await approvePendingUser({
                userId: req.params.id,
                collegeName: req.session.user.collegeName
            });

            if (!result.success) {
                return res.status(result.status || 400).json({ success: false, message: result.error || 'Approval failed.' });
            }

            res.json({ success: true, message: result.message });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/api/pending-faculty/:id/reject', requireRole('admin'), async (req, res) => {
        const userId = Number(req.params.id);
        const collegeName = req.session.user.collegeName;

        try {
            const userRow = await dbGetAsync(
                `SELECT id, role, pending_college_name, college_request_status, collegeName
                 FROM users WHERE id = ?`,
                [userId]
            );

            if (!userRow) {
                return res.status(404).json({ success: false, message: 'User not found.' });
            }

            const isStudentCollegeRequest = String(userRow.role || '').toLowerCase() === 'student'
                && String(userRow.college_request_status || '').toLowerCase() === 'pending'
                && String(userRow.pending_college_name || '') === String(collegeName || '');

            if (isStudentCollegeRequest) {
                db.run(
                    `UPDATE users
                     SET pending_college_name = '',
                         college_request_status = 'rejected'
                     WHERE id = ?`,
                    [userId],
                    function (err) {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        res.json({ success: true, message: 'College change request rejected.' });
                    }
                );
                return;
            }

            db.run(
                `UPDATE users
                 SET status = 'rejected'
                 WHERE id = ? AND collegeName = ?`,
                [userId, collegeName],
                function (err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    if (this.changes === 0) return res.status(404).json({ success: false, message: 'User not found in pending requests.' });
                    res.json({ success: true, message: 'User request rejected.' });
                }
            );
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/api/pending-faculty/bulk-approve', requireRole('admin'), async (req, res) => {
        const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
        if (!userIds.length) {
            return res.status(400).json({ success: false, message: 'No users selected.' });
        }

        try {
            let approvedCount = 0;
            for (const userId of userIds) {
                const result = await approvePendingUser({
                    userId,
                    collegeName: req.session.user.collegeName
                });
                if (result.success) approvedCount += 1;
            }

            res.json({ success: true, message: `Approved ${approvedCount} request(s).` });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    router.get('/api/users', requireRole('admin'), async (req, res) => {
        const collegeName = req.session.user.collegeName;

        try {
            const users = await dbAllAsync(`
                SELECT u.*,
                    (SELECT COUNT(*) FROM contests WHERE createdBy = u.id AND status = 'accepted') AS contests_created,
                    (SELECT COUNT(*) FROM problems WHERE faculty_id = u.id AND status = 'accepted') AS problems_created,
                    (SELECT COUNT(DISTINCT problem_id) FROM submissions WHERE user_id = u.id AND status = 'accepted') AS problems_solved,
                    (SELECT COUNT(DISTINCT contest_id) FROM contest_participants WHERE user_id = u.id) AS contests_participated
                FROM users u
                WHERE u.collegeName = ? AND u.role IN ('student', 'faculty', 'hod', 'hos') AND u.status = 'active'
                ORDER BY u.id DESC
            `, [collegeName]);

            const studentIds = users
                .filter((user) => String(user.role || '').toLowerCase() === 'student')
                .map((user) => Number(user.id))
                .filter((id) => Number.isInteger(id));

            let streakMap = new Map();
            if (studentIds.length) {
                const placeholders = studentIds.map(() => '?').join(',');
                const submissionDays = await dbAllAsync(`
                    SELECT user_id, DATE(COALESCE(createdAt, CURRENT_TIMESTAMP)) AS submitted_on
                    FROM submissions
                    WHERE user_id IN (${placeholders})
                      AND LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                    GROUP BY user_id, DATE(COALESCE(createdAt, CURRENT_TIMESTAMP))
                    ORDER BY user_id ASC, submitted_on DESC
                `, studentIds);

                const datesByUser = new Map();
                submissionDays.forEach((row) => {
                    const key = Number(row.user_id);
                    if (!datesByUser.has(key)) datesByUser.set(key, []);
                    datesByUser.get(key).push(row.submitted_on);
                });

                streakMap = new Map(
                    Array.from(datesByUser.entries()).map(([userId, dates]) => [userId, calculateConsecutiveDayStreak(dates)])
                );
            }

            const collegeRankMap = buildRankMap(
                users
                    .filter((user) => String(user.role || '').toLowerCase() === 'student')
                    .map((user) => ({ id: user.id, points: Number(user.points || 0) }))
            );

            const globalRankMap = buildRankMap(
                await dbAllAsync(`
                    SELECT id, COALESCE(points, 0) AS points
                    FROM users
                    WHERE LOWER(COALESCE(role, '')) = 'student'
                      AND status = 'active'
                `)
            );

            const normalizedUsers = users.map((user) => {
                const isStudent = String(user.role || '').toLowerCase() === 'student';
                const points = Number(user.points || 0);
                const problemsCreated = Number(user.problems_created || 0);
                const contestsCreated = Number(user.contests_created || 0);
                const solvedCount = Number(user.problems_solved || user.solvedCount || 0);
                const streak = isStudent ? Number(streakMap.get(Number(user.id)) || 0) : 0;
                const level = isStudent ? Math.max(1, Math.floor(points / 150) + 1) : Math.max(1, problemsCreated + contestsCreated);
                const platformRating = Math.min(
                    5,
                    ((problemsCreated * 0.35) + (contestsCreated * 0.65) + (Number(user.contests_participated || 0) * 0.05)).toFixed(1)
                );

                return {
                    ...user,
                    streak,
                    college_rank: isStudent ? (collegeRankMap.get(Number(user.id)) || '-') : '-',
                    global_rank: isStudent ? (globalRankMap.get(Number(user.id)) || '-') : '-',
                    level,
                    problems_solved: solvedCount,
                    rating: String(platformRating)
                };
            });

            res.json({ success: true, users: normalizedUsers });
        } catch (err) {
            console.error('Error fetching users:', err && err.message ? err.message : err);
            res.status(500).json({ success: false, error: err.message || 'Database error' });
        }
    });

    router.post('/api/users/bulk', requireRole('admin'), async (req, res) => {
        const { users } = req.body;
        const collegeName = req.session.user.collegeName;

        if (!users || !Array.isArray(users) || users.length === 0) {
            return res.status(400).json({ success: false, error: "No valid user data provided." });
        }

        let successCount = 0;
        let skippedCount = 0;
        let errors = [];

        for (const user of users) {
            try {
                // Dynamically fetch default password if provided, else generate random
                const plainPwd = user.defaultPassword || Math.random().toString(36).slice(-8);
                const hashedPassword = await bcrypt.hash(plainPwd, 10);
                const resolvedAcademic = await resolveAcademicFields(collegeName, user);
                
                await new Promise((resolve, reject) => {
                    db.run(`INSERT INTO users (fullName, email, role, password, collegeName, program, branch, department, year, section, status, is_verified, isVerified) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 1)`,
                    [
                        user.fullName.trim(), 
                        user.email.toLowerCase().trim(), // Standardize email format
                        user.role, 
                        hashedPassword, 
                        collegeName, 
                        resolvedAcademic.program || '',
                        resolvedAcademic.branch || '',
                        resolvedAcademic.department || '',
                        resolvedAcademic.year || '',
                        resolvedAcademic.section || ''
                    ], function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                });
                
                successCount++;

                // ⭐ NEW: Send Email with Credentials asynchronously
                const userEmail = user.email.toLowerCase().trim();
                const mailOptions = {
                    from: process.env.EMAIL_USER || 'no-reply@campuscode.com',
                    to: userEmail,
                    subject: 'Welcome to CampusCode - Your Login Credentials',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                            <h2 style="color: #2E5E99;">Welcome to CampusCode!</h2>
                            <p>Hello <strong>${user.fullName.trim()}</strong>,</p>
                            <p>Your account has been created by your administrator.</p>
                            <p>Here are your login credentials:</p>
                            <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin: 15px 0;">
                                <p style="margin: 0;"><strong>Email:</strong> ${userEmail}</p>
                                <p style="margin: 5px 0 0 0;"><strong>Password:</strong> <span style="color: #d9534f; font-weight: bold; letter-spacing: 1px;">${plainPwd}</span></p>
                            </div>
                            <p>Please log in and change your password immediately for security purposes.</p>
                            <p>Best Regards,<br>CampusCode Team</p>
                        </div>
                    `
                };

                // Send mail without awaiting it to prevent blocking the entire loop
                transporter.sendMail(mailOptions).catch(err => {
                    console.error(`Failed to send email to ${userEmail}:`, err.message);
                });

            } catch (err) {
                // Check for duplicate emails and inform the admin instead of silently failing
                if (err.message.includes('UNIQUE constraint failed')) {
                    skippedCount++;
                    errors.push(`${user.email} (Email already exists)`);
                } else {
                    errors.push(`Failed for ${user.email}: ${err.message}`);
                }
            }
        }

        // Construct a helpful message for the frontend popup
        let finalMessage = `Successfully imported ${successCount} users.`;
        if (skippedCount > 0) {
            finalMessage += ` Skipped ${skippedCount} existing users.`;
        }

        res.json({ 
            success: true, 
            message: finalMessage, 
            errors: errors.length > 0 ? errors : undefined 
        });
    });

    router.post('/api/users', requireRole('admin'), async (req, res) => {
        const { role, fullName, email, password, branch, is_hod, program, year, section } = req.body;
        const collegeName = req.session.user.collegeName;

        try {
            if (!fullName || !email) {
                return res.status(400).json({ success: false, error: "Name and Email are required." });
            }

            db.get(`SELECT id FROM users WHERE email = ?`, [email], async (err, existing) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (existing) return res.status(409).json({ success: false, error: "Email already in use." });

                if (role === 'faculty' && is_hod === 1) {
                    const exists = await checkHODExists(db, collegeName, branch);
                    if (exists) {
                        return res.status(400).json({ success: false, error: `An HOD already exists for the ${branch} branch.` });
                    }
                }

                // Completely dynamic password generation if none provided
                const plainPassword = password || Math.random().toString(36).slice(-10);
                const hashedPassword = await bcrypt.hash(plainPassword, 10);
                const resolvedAcademic = await resolveAcademicFields(collegeName, {
                    role, program, branch, year, section
                });

                db.run(`INSERT INTO users (role, fullName, email, password, collegeName, branch, department, is_hod, status, program, course, year, section) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`, 
                    [
                        role,
                        fullName,
                        email,
                        hashedPassword,
                        collegeName,
                        resolvedAcademic.branch || null,
                        resolvedAcademic.department || null,
                        is_hod || 0,
                        resolvedAcademic.program || null,
                        resolvedAcademic.course || null,
                        resolvedAcademic.year || null,
                        resolvedAcademic.section || null
                    ], function(err) {
                        if (err) return res.status(500).json({ success: false, error: err.message });
                        
                        if (transporter) {
                            const mailOptions = {
                                from: process.env.EMAIL_USER,
                                to: email,
                                subject: 'Welcome to CampusCode!',
                                html: `
                                    <div style="font-family: sans-serif; padding: 20px;">
                                        <h2>Hello ${fullName},</h2>
                                        <p>You have been onboarded to CampusCode as a <strong>${role}</strong>.</p>
                                        <p>Your login credentials are:</p>
                                        <ul>
                                            <li><strong>Email:</strong> ${email}</li>
                                            <li><strong>Password:</strong> ${plainPassword}</li>
                                        </ul>
                                        <p>We strongly recommend changing your password after logging in!</p>
                                    </div>
                                `
                            };
                            transporter.sendMail(mailOptions).catch(err => console.error('Welcome email failed:', err));
                        }

                        res.json({ success: true, id: this.lastID, message: 'User added successfully' });
                    });
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message || "Validation error" });
        }
    });

    router.put('/api/users/:id', requireRole('admin'), async (req, res) => {
        const { fullName, email, role, password, branch, is_hod, program, year, section } = req.body;
        const collegeName = req.session.user.collegeName;
        const userId = req.params.id;

        try {
            if (role === 'faculty' && is_hod === 1) {
                const exists = await checkHODExists(db, collegeName, branch, userId);
                if (exists) {
                    return res.status(400).json({ success: false, error: `An HOD already exists for the ${branch} branch.` });
                }
            }

            const resolvedAcademic = await resolveAcademicFields(collegeName, {
                role, program, branch, year, section
            });

            let query = `UPDATE users SET fullName = ?, email = ?, role = ?, branch = ?, department = ?, is_hod = ?, program = ?, course = ?, year = ?, section = ?`;
            let params = [
                fullName,
                email,
                role,
                resolvedAcademic.branch || null,
                resolvedAcademic.department || null,
                is_hod || 0,
                resolvedAcademic.program || null,
                resolvedAcademic.course || null,
                resolvedAcademic.year || null,
                resolvedAcademic.section || null
            ];

            if (password && password.trim() !== '') {
                const hashedPassword = await bcrypt.hash(password, 10);
                query += `, password = ?`;
                params.push(hashedPassword);
            }

            query += ` WHERE id = ? AND collegeName = ?`;
            params.push(userId, collegeName);

            db.run(query, params, function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, message: 'User updated successfully' });
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message || "Validation error" });
        }
    });

    router.put('/api/faculty/:id/hod', requireRole('admin'), async (req, res) => {
        const { is_hod } = req.body;
        const userId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            if (is_hod === 1) {
                db.get(`SELECT branch, fullName FROM users WHERE id = ?`, [userId], async (err, facultyUser) => {
                    if (err || !facultyUser) return res.status(404).json({ success: false, error: 'User not found' });
                    
                    const exists = await checkHODExists(db, collegeName, facultyUser.branch, userId);
                    if (exists) return res.status(400).json({ success: false, error: `An HOD already exists for the ${facultyUser.branch} branch.` });

                    db.run(`UPDATE users SET is_hod = 1, role = 'hod' WHERE id = ? AND collegeName = ?`, [userId, collegeName], (err) => {
                        if (err) return res.status(500).json({ success: false, error: err.message });
                        
                        // Dynamically map semester to year via database math to remove hardcoded strings
                        const syncQuery = `
                            INSERT OR IGNORE INTO user_assignments (user_id, subject, year, section, assigned_by_id, collegeName)
                            SELECT ?, sub.name, 
                                   (CAST(((s.semester + 1) / 2) AS TEXT) || ' Year'), 
                                   s.name, ?, ?
                            FROM subjects sub
                            JOIN sections s ON sub.section_id = s.id
                            JOIN branches b ON s.branch_id = b.id
                            WHERE b.collegeName = ? AND (b.name = ? OR b.abbreviation = ?)
                        `;

                        db.run(syncQuery, [userId, req.session.user.id, collegeName, collegeName, facultyUser.branch, facultyUser.branch], (err) => {
                            if (err) console.error("HOD Sync Error:", err);
                            res.json({ success: true, message: `HOD status granted and ${facultyUser.branch} structure synced.` });
                        });
                    });
                });
            } else {
                db.run(`UPDATE users SET is_hod = 0, role = 'faculty' WHERE id = ? AND collegeName = ?`, [userId, collegeName], (err) => {
                    if (err) return res.status(500).json({ success: false, error: err.message });
                    res.json({ success: true, message: 'HOD status revoked' });
                });
            }
        } catch(err) { 
            res.status(500).json({ success: false, error: err.message }); 
        }
    });

    router.delete('/api/users/:id', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.run(`DELETE FROM users WHERE id = ? AND collegeName = ?`, [req.params.id, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, message: 'User deleted successfully' });
        });
    });

    // ==========================================
    // ⭐ ACADEMIC STRUCTURE APIs
    // ==========================================

    router.get('/api/colleges', requireRole('admin'), (req, res) => {
        db.all(`SELECT name FROM colleges WHERE status = 'active' ORDER BY name ASC`, [], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows.map(r => r.name) });
        });
    });

    router.get('/api/programs', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.all(`SELECT * FROM programs WHERE collegeName = ? OR collegeName IS NULL`, [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.get('/programs', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.all(`SELECT * FROM programs WHERE collegeName = ? OR collegeName IS NULL`, [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.get('/branches', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        const query = `
            SELECT b.*, p.name as program_name, p.duration as program_duration 
            FROM branches b 
            JOIN programs p ON b.program_id = p.id
            WHERE p.collegeName = ? OR p.collegeName IS NULL
        `;
        db.all(query, [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.get('/api/branches', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        const query = `
            SELECT b.*, p.name as program_name, p.duration as program_duration
            FROM branches b
            JOIN programs p ON b.program_id = p.id
            WHERE p.collegeName = ? OR p.collegeName IS NULL
        `;
        db.all(query, [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.get('/sections', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        const query = `
            SELECT s.*, b.name as branch_name, p.name as program_name, p.duration as program_duration 
            FROM sections s 
            JOIN branches b ON s.branch_id = b.id
            JOIN programs p ON b.program_id = p.id
            WHERE (p.collegeName = ? OR p.collegeName IS NULL) AND (s.collegeName = ? OR s.collegeName IS NULL)
        `;
        db.all(query, [collegeName, collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.get('/api/sections', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        const query = `
            SELECT s.*, b.name as branch_name, p.name as program_name, p.duration as program_duration
            FROM sections s
            JOIN branches b ON s.branch_id = b.id
            JOIN programs p ON b.program_id = p.id
            WHERE (p.collegeName = ? OR p.collegeName IS NULL) AND (s.collegeName = ? OR s.collegeName IS NULL)
        `;
        db.all(query, [collegeName, collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.get('/subjects', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        const query = `
            SELECT sub.*, b.name as branch_name, p.name as program_name, p.duration as program_duration
            FROM subjects sub
            JOIN branches b ON sub.branch_id = b.id
            JOIN programs p ON b.program_id = p.id
            WHERE (p.collegeName = ? OR p.collegeName IS NULL) AND (sub.collegeName = ? OR sub.collegeName IS NULL)
        `;
        db.all(query, [collegeName, collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.post('/add-program', requireRole('admin'), (req, res) => {
        const { name, code, type, duration } = req.body;
        const collegeName = req.session.user.collegeName; 

        ensureUniqueAcademicCode({ table: 'programs', code, collegeName })
            .then((existingCode) => {
                if (existingCode) {
                    return res.status(409).json({ success: false, message: 'This program code is already used. Please enter a different code.' });
                }

                db.run(`INSERT INTO programs (collegeName, name, code, type, duration) VALUES (?, ?, ?, ?, ?)`, 
                    [collegeName, name, normalizeEntityCode(code), type, duration], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, id: this.lastID, message: "Program added!" });
                });
            })
            .catch((err) => res.status(500).json({ success: false, message: err.message }));
    });

    router.post('/add-branch', requireRole('admin'), (req, res) => {
        const { program_id, name, code, abbreviation } = req.body;
        const collegeName = req.session.user.collegeName;

        ensureUniqueAcademicCode({ table: 'branches', code, collegeName })
            .then((existingCode) => {
                if (existingCode) {
                    return res.status(409).json({ success: false, message: 'This branch code is already used. Please enter a different code.' });
                }

                db.run(`INSERT INTO branches (program_id, name, code, abbreviation, collegeName) VALUES (?, ?, ?, ?, ?)`, 
                    [program_id, name, normalizeEntityCode(code), abbreviation, collegeName], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, id: this.lastID, message: "Branch added!" });
                });
            })
            .catch((err) => res.status(500).json({ success: false, message: err.message }));
    });

    router.post('/add-section', requireRole('admin'), (req, res) => {
        const { branch_id, name, year, semester, capacity } = req.body;
        const collegeName = req.session.user.collegeName;
        db.run(`INSERT INTO sections (branch_id, name, year, semester, capacity, collegeName) VALUES (?, ?, ?, ?, ?, ?)`, 
            [branch_id, name, year, semester || null, capacity || null, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, id: this.lastID, message: "Section added!" });
        });
    });

    router.post('/add-subject', requireRole('admin'), (req, res) => {
        const { branch_id, section_id, name, code, credits } = req.body;
        const collegeName = req.session.user.collegeName;

        ensureUniqueAcademicCode({ table: 'subjects', code, collegeName })
            .then((existingCode) => {
                if (existingCode) {
                    return res.status(409).json({ success: false, message: 'This subject code is already used. Please enter a different code.' });
                }

                db.get(`SELECT year, semester FROM sections WHERE id = ?`, [section_id], (err, section) => {
                    const finalYear = (section && section.year) ? section.year : null; 
                    const finalSemester = (section && section.semester) ? section.semester : null;

                    db.run(`INSERT INTO subjects (branch_id, section_id, name, code, credits, year, semester, collegeName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                        [branch_id, section_id || null, name, normalizeEntityCode(code), credits, finalYear, finalSemester, collegeName], function(err) {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        res.json({ success: true, id: this.lastID, message: "Subject added!" });
                    });
                });
            })
            .catch((err) => res.status(500).json({ success: false, message: err.message }));
    });

    router.post('/edit-program', requireRole('admin'), (req, res) => {
        const { id, name, code, type, duration } = req.body;
        const collegeName = req.session.user.collegeName;

        ensureUniqueAcademicCode({ table: 'programs', code, collegeName, excludeId: id })
            .then((existingCode) => {
                if (existingCode) {
                    return res.status(409).json({ success: false, message: 'This program code is already used. Please enter a different code.' });
                }

                db.run(`UPDATE programs SET name=?, code=?, type=?, duration=? WHERE id=? AND collegeName=?`, 
                    [name, normalizeEntityCode(code), type, duration, id, collegeName], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true });
                });
            })
            .catch((err) => res.status(500).json({ success: false, message: err.message }));
    });

    router.post('/edit-branch', requireRole('admin'), (req, res) => {
        const { id, program_id, name, code, abbreviation } = req.body;

        ensureUniqueAcademicCode({ table: 'branches', code, collegeName: req.session.user.collegeName, excludeId: id })
            .then((existingCode) => {
                if (existingCode) {
                    return res.status(409).json({ success: false, message: 'This branch code is already used. Please enter a different code.' });
                }

                db.run(`UPDATE branches SET program_id=?, name=?, code=?, abbreviation=? WHERE id=?`, 
                    [program_id, name, normalizeEntityCode(code), abbreviation, id], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true });
                });
            })
            .catch((err) => res.status(500).json({ success: false, message: err.message }));
    });

    router.post('/edit-section', requireRole('admin'), (req, res) => {
        const { id, branch_id, name, year, semester, capacity } = req.body;
        db.run(`UPDATE sections SET branch_id=?, name=?, year=?, semester=?, capacity=? WHERE id=?`, 
            [branch_id, name, year, semester || null, capacity || null, id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.post('/edit-subject', requireRole('admin'), (req, res) => {
        const { id, branch_id, section_id, name, code, credits } = req.body;

        ensureUniqueAcademicCode({ table: 'subjects', code, collegeName: req.session.user.collegeName, excludeId: id })
            .then((existingCode) => {
                if (existingCode) {
                    return res.status(409).json({ success: false, message: 'This subject code is already used. Please enter a different code.' });
                }
        
                db.get(`SELECT year, semester FROM sections WHERE id = ?`, [section_id], (err, section) => {
                    const finalYear = (section && section.year) ? section.year : null; 
                    const finalSemester = (section && section.semester) ? section.semester : null;

                    db.run(`UPDATE subjects SET branch_id=?, section_id=?, name=?, code=?, credits=?, year=?, semester=? WHERE id=?`, 
                        [branch_id, section_id || null, name, normalizeEntityCode(code), credits, finalYear, finalSemester, id], function(err) {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        res.json({ success: true });
                    });
                });
            })
            .catch((err) => res.status(500).json({ success: false, message: err.message }));
    });

    router.delete('/delete-program/:id', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.run(`DELETE FROM programs WHERE id=? AND collegeName=?`, [req.params.id, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.delete('/delete-branch/:id', requireRole('admin'), (req, res) => {
        db.run(`DELETE FROM branches WHERE id=?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.delete('/delete-section/:id', requireRole('admin'), (req, res) => {
        db.run(`DELETE FROM sections WHERE id=?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.delete('/delete-subject/:id', requireRole('admin'), (req, res) => {
        db.run(`DELETE FROM subjects WHERE id=?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.put('/update-program/:id', requireRole('admin'), (req, res) => {
        const { name, code, type, duration } = req.body;
        const collegeName = req.session.user.collegeName;

        ensureUniqueAcademicCode({ table: 'programs', code, collegeName, excludeId: req.params.id })
            .then((existingCode) => {
                if (existingCode) {
                    return res.status(409).json({ success: false, message: 'This program code is already used. Please enter a different code.' });
                }

                db.run(`UPDATE programs SET name=?, code=?, type=?, duration=? WHERE id=? AND collegeName=?`, 
                    [name, normalizeEntityCode(code), type, duration, req.params.id, collegeName], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true });
                });
            })
            .catch((err) => res.status(500).json({ success: false, message: err.message }));
    });

    router.put('/update-branch/:id', requireRole('admin'), (req, res) => {
        const { name, code, abbreviation } = req.body;

        ensureUniqueAcademicCode({ table: 'branches', code, collegeName: req.session.user.collegeName, excludeId: req.params.id })
            .then((existingCode) => {
                if (existingCode) {
                    return res.status(409).json({ success: false, message: 'This branch code is already used. Please enter a different code.' });
                }

                db.run(`UPDATE branches SET name=?, code=?, abbreviation=? WHERE id=?`, 
                    [name, normalizeEntityCode(code), abbreviation, req.params.id], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true });
                });
            })
            .catch((err) => res.status(500).json({ success: false, message: err.message }));
    });

    router.put('/update-section/:id', requireRole('admin'), (req, res) => {
        const { name, year, semester, capacity } = req.body;
        db.run(`UPDATE sections SET name=?, year=?, semester=?, capacity=? WHERE id=?`, 
            [name, year, semester || null, capacity || null, req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.put('/update-subject/:id', requireRole('admin'), (req, res) => {
        const { name, code, credits, section_id } = req.body;

        ensureUniqueAcademicCode({ table: 'subjects', code, collegeName: req.session.user.collegeName, excludeId: req.params.id })
            .then((existingCode) => {
                if (existingCode) {
                    return res.status(409).json({ success: false, message: 'This subject code is already used. Please enter a different code.' });
                }

                db.get(`SELECT year, semester FROM sections WHERE id = ?`, [section_id], (err, section) => {
                    const finalYear = (section && section.year) ? section.year : null;
                    const finalSemester = (section && section.semester) ? section.semester : null;

                    db.run(`UPDATE subjects SET name=?, code=?, credits=?, section_id=?, year=?, semester=? WHERE id=?`, 
                        [name, normalizeEntityCode(code), credits, section_id || null, finalYear, finalSemester, req.params.id], function(err) {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        res.json({ success: true });
                    });
                });
            })
            .catch((err) => res.status(500).json({ success: false, message: err.message }));
    });

    // ==========================================
    // CONTESTS & PROBLEMS APIs 
    // ==========================================
    router.get('/api/contests', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.all(`
            SELECT c.*
            FROM contests c
            LEFT JOIN account_users cu ON cu.id = c.createdBy
            WHERE LOWER(
                TRIM(
                    COALESCE(
                        NULLIF(c.collegeName, ''),
                        NULLIF(cu.collegeName, ''),
                        ''
                    )
                )
            ) = LOWER(TRIM(COALESCE(?, '')))
            ORDER BY c.id DESC
        `, [collegeName], (err, rows) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                
                const contests = rows.map(row => {
                    try {
                        row.colleges = row.colleges ? JSON.parse(row.colleges) : [];
                    } catch(e) {
                        row.colleges = [];
                    }
                    return row;
                });
                
                res.json({ success: true, data: contests });
            });
        });

    router.get('/api/contests/level/:level', requireRole('admin'), (req, res) => {
        const level = String(req.params.level || '').trim().toLowerCase();
        const collegeName = req.session.user.collegeName;

        let query = `
            SELECT c.*, LOWER(COALESCE(cu.role, '')) AS creator_role
            FROM contests c
            LEFT JOIN account_users cu ON cu.id = c.createdBy
            WHERE 1 = 1
        `;
        const params = [];

        // Superadmin-created contests are always treated as global in college admin view.
        if (level === 'global') {
            query += `
                AND (
                    LOWER(COALESCE(cu.role, '')) = 'superadmin'
                    OR LOWER(COALESCE(NULLIF(c.scope, ''), NULLIF(c.level, ''), 'college')) = 'global'
                )
            `;
        } else if (level === 'college') {
            query += `
                AND LOWER(COALESCE(NULLIF(c.scope, ''), NULLIF(c.level, ''), 'college')) = 'college'
                AND LOWER(COALESCE(cu.role, '')) != 'superadmin'
            `;
        } else if (level === 'multi-college') {
            query += `
                AND LOWER(COALESCE(NULLIF(c.scope, ''), NULLIF(c.level, ''), 'college')) = 'multi-college'
                AND LOWER(COALESCE(cu.role, '')) != 'superadmin'
            `;
        } else {
            query += ` AND LOWER(COALESCE(NULLIF(c.scope, ''), NULLIF(c.level, ''), 'college')) = ?`;
            params.push(level);
        }

        if (level === 'college') {
            query += `
                AND LOWER(
                    TRIM(
                        COALESCE(
                            NULLIF(c.collegeName, ''),
                            NULLIF(cu.collegeName, ''),
                            ''
                        )
                    )
                ) = LOWER(TRIM(COALESCE(?, '')))
            `;
            params.push(collegeName);
        } else if (level === 'multi-college') {
            query += `
                AND (
                    EXISTS (
                        SELECT 1
                        FROM json_each(CASE
                            WHEN TRIM(COALESCE(c.colleges, '')) = '' THEN '[]'
                            ELSE c.colleges
                        END)
                        WHERE LOWER(TRIM(json_each.value)) = LOWER(TRIM(COALESCE(?, '')))
                    )
                    OR LOWER(
                        TRIM(
                            COALESCE(
                                NULLIF(c.collegeName, ''),
                                NULLIF(cu.collegeName, ''),
                                ''
                            )
                        )
                    ) = LOWER(TRIM(COALESCE(?, '')))
                )
            `;
            params.push(collegeName, collegeName);
        }

        query += ` ORDER BY c.id DESC`;

        db.all(query, params, (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, contests: rows, currentUser: req.session.user.id });
        });
    });

    router.post('/api/contests', requireRole('admin'), (req, res) => {
        const {
            title, scope, level, date, deadline, duration, eligibility, description, discription,
            rulesAndDescription, guidelines, colleges, problem_ids, prize, class: contestClassInput, contest_class,
            startDate, endDate
        } = req.body;
        const collegesStr = colleges ? JSON.stringify(colleges) : '[]';
        const createdBy = req.session.user.id;
        const role = req.session.user.role;
        const collegeName = req.session.user.collegeName;

        const normalizedClass = contestClassInput || contest_class || null;
        const finalDescription = description || discription || '';
        const finalGuidelines = guidelines || rulesAndDescription || '';
        const finalStartDate = startDate || date || null;
        const finalEndDate = endDate || deadline || null;
        
        let finalScope = scope || 'college';
        if (role === 'superadmin') finalScope = 'global';

        db.run(`INSERT INTO contests (
                    title, scope, level, date, deadline, duration, eligibility, description, rulesAndDescription,
                    guidelines, contest_class, prize, startDate, endDate,
                    status, colleges, createdBy, collegeName, hos_verified, hod_verified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, 1, 1)`,
            [
                title, finalScope, level, date, deadline, duration, eligibility, finalDescription, finalGuidelines,
                finalGuidelines, normalizedClass, prize || '', finalStartDate, finalEndDate,
                collegesStr, createdBy, collegeName
            ],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                
                const contestId = this.lastID;
                
                if (problem_ids && Array.isArray(problem_ids) && problem_ids.length > 0) {
                    const stmt = db.prepare(`INSERT INTO contest_problems (contest_id, problem_id) VALUES (?, ?)`);
                    problem_ids.forEach(problemId => stmt.run([contestId, problemId]));
                    stmt.finalize();
                }

                res.json({ success: true, id: contestId, message: "Contest created and published successfully!" });
            });
    });

    router.get('/api/problems', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        const query = `
            SELECT p.*, u.collegeName, u.role as creator_role
            FROM problems p
            LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id
            WHERE LOWER(COALESCE(u.collegeName, '')) = LOWER(?)
               OR LOWER(COALESCE(u.role, '')) = 'superadmin'
            ORDER BY p.id DESC
        `;

        db.all(query, [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.post('/api/problems', requireRole('admin'), (req, res) => {
        const { title, difficulty, score, constraints, description } = req.body;
        
        // Set universal XP points based on difficulty (ignore custom score)
        const getPointsFromDifficulty = (diff) => {
            const normalizedDiff = String(diff || 'easy').toLowerCase();
            switch (normalizedDiff) {
                case 'easy': return 5;
                case 'medium': return 10;
                case 'hard': return 15;
                default: return 5; // default to easy
            }
        };
        const calculatedPoints = getPointsFromDifficulty(difficulty);
        
        db.run(`INSERT INTO problems (title, difficulty, points, constraints, description) 
                VALUES (?, ?, ?, ?, ?)`, 
            [title, difficulty, calculatedPoints, constraints, description], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, id: this.lastID, message: "Problem created successfully!" });
            });
    });
router.put('/api/contests/:id', requireRole('admin'), (req, res) => {
        const {
            title, scope, level, date, deadline, duration, eligibility, description, discription,
            rulesAndDescription, guidelines, status, colleges, class: contestClassInput, contest_class, prize,
            startDate, endDate
        } = req.body;

        const collegesStr = colleges ? JSON.stringify(colleges) : '[]';
        const role = req.session.user.role;

        const normalizedClass = contestClassInput || contest_class || null;
            
        const finalDescription = description || discription || '';
        const finalGuidelines = guidelines || rulesAndDescription || '';
        const finalStartDate = startDate || date || null;
        const finalEndDate = endDate || deadline || null;
        
        let finalScope = scope || 'college';
        if (role === 'superadmin') finalScope = 'global';

        db.run(`UPDATE contests
                SET title=?, scope=?, level=?, date=?, deadline=?, duration=?, eligibility=?, description=?, rulesAndDescription=?,
                    guidelines=?, contest_class=?, prize=?, startDate=?, endDate=?, status=?, colleges=?
                WHERE id=?`,
            [
                title, finalScope, level, date, deadline, duration, eligibility, finalDescription, finalGuidelines,
                finalGuidelines, normalizedClass, prize || '', finalStartDate, finalEndDate, status || 'upcoming', collegesStr,
                req.params.id
            ],
            function(err) {
                if (err) {
                    console.error("Update Error:", err.message);
                    return res.status(500).json({ success: false, message: err.message });
                }
                res.json({ success: true, message: "Contest updated successfully!" });
            });
    });

    router.delete('/api/contests/:id', requireRole('admin'), (req, res) => {
        db.run(`DELETE FROM contests WHERE id=?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: "Contest deleted successfully!" });
        });
    });

    router.get('/api/contests/:id/problems', requireRole('admin'), (req, res) => {
        db.all(`SELECT p.* FROM problems p JOIN contest_problems cp ON p.id = cp.problem_id WHERE cp.contest_id = ?`, [req.params.id], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.post('/api/contests/:id/problems', requireRole('admin'), (req, res) => {
        const { problemIds } = req.body;
        const contestId = req.params.id;
        
        db.run(`DELETE FROM contest_problems WHERE contest_id = ?`, [contestId], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            
            if (problemIds && Array.isArray(problemIds) && problemIds.length > 0) {
                const stmt = db.prepare(`INSERT INTO contest_problems (contest_id, problem_id) VALUES (?, ?)`);
                problemIds.forEach(problemId => stmt.run([contestId, problemId]));
                stmt.finalize();
            }
            res.json({ success: true, message: "Problems updated successfully!" });
        });
    });

    // ==========================================
    // VERIFICATION FLOW APIs
    // ==========================================
    
    router.get('/requests', requireRole('admin'), (req, res) => {
        res.render('admin/requests');
    });

    router.get('/api/pending-verifications', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.all(`SELECT id, fullName, email, collegeName, role FROM users WHERE is_verified = 0 AND status = 'pending' AND collegeName = ?`, [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, pending: rows });
        });
    });

    router.post('/api/verify-user', requireRole('admin'), (req, res) => {
        const { userId, course, branch, role } = req.body; 
        const collegeName = req.session.user.collegeName;

        if (!course || !branch) {
            return res.status(400).json({ success: false, error: "Course and Branch are required." });
        }

        db.run(`UPDATE users SET is_verified = 1, isVerified = 1, status = 'active', course = ?, branch = ?, department = ?, role = COALESCE(?, role) WHERE id = ? AND collegeName = ?`,
            [course, branch, branch, role || null, userId, collegeName], function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, error: "User not found or already verified." });
                res.json({ success: true, message: "User verified successfully!" });
            });
    });

    // ==========================================
    // PUBLIC PROFILE APIs
    // ==========================================
    router.get('/api/faculty/public-profile/:id', requireRole('admin'), async (req, res) => {
        const facultyId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            const user = await dbGetAsync(
                `SELECT id, fullName, email, department, branch, program, collegeName, role, status, is_hod
                 FROM users
                 WHERE id = ? AND collegeName = ?`,
                [facultyId, collegeName]
            );
            if (!user) return res.status(404).json({ success: false, message: "Faculty not found" });

            const stats = await dbGetAsync(
                `SELECT
                    (SELECT COUNT(*) FROM contests WHERE createdBy = ?) as totalContests,
                    (SELECT COUNT(*) FROM problems WHERE faculty_id = ?) as totalProblems,
                    (SELECT COUNT(*) FROM submissions s
                     JOIN problems p ON p.id = s.problem_id
                     WHERE p.faculty_id = ? AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass')) as acceptedSubmissions,
                    (SELECT COUNT(DISTINCT s.user_id) FROM submissions s
                     JOIN problems p ON p.id = s.problem_id
                     WHERE p.faculty_id = ?) as learnerReach`,
                [facultyId, facultyId, facultyId, facultyId]
            );

            const recentActivity = await dbAllAsync(
                `SELECT *
                 FROM (
                    SELECT
                        'problem' as type,
                        p.id as itemId,
                        p.title as title,
                        COALESCE(NULLIF(p.status, ''), 'draft') as status,
                        COALESCE(p.createdAt, '') as activityAt
                    FROM problems p
                    WHERE p.faculty_id = ?

                    UNION ALL

                    SELECT
                        'contest' as type,
                        c.id as itemId,
                        c.title as title,
                        COALESCE(NULLIF(c.status, ''), 'draft') as status,
                        COALESCE(c.createdAt, c.startDate, '') as activityAt
                    FROM contests c
                    WHERE c.createdBy = ?
                 )
                 ORDER BY datetime(activityAt) DESC, itemId DESC
                 LIMIT 5`,
                [facultyId, facultyId]
            );

            res.json({
                success: true,
                faculty: user,
                stats: {
                    problemsCreated: stats ? stats.totalProblems : 0,
                    activeContests: stats ? stats.totalContests : 0,
                    platformRating: Number(Math.min(
                        5,
                        ((Number(stats?.totalProblems || 0) * 0.35)
                            + (Number(stats?.totalContests || 0) * 0.65)
                            + (Number(stats?.acceptedSubmissions || 0) * 0.02)
                            + (Number(stats?.learnerReach || 0) * 0.05))
                    ).toFixed(1))
                },
                recentActivity
            });
        } catch (error) {
            console.error('Admin faculty public profile error:', error);
            res.status(500).json({ success: false, message: "Database error" });
        }
    });

    router.get('/api/student/public-profile/:id', requireRole('admin'), async (req, res) => {
        const studentId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            const user = await dbGetAsync(
                `SELECT
                    id, fullName, email, department, branch, program, year, section, collegeName, role, status,
                    COALESCE(points, 0) as points,
                    COALESCE(solvedCount, 0) as solvedCount,
                    rank
                 FROM users
                 WHERE id = ? AND collegeName = ? AND role = 'student'`,
                [studentId, collegeName]
            );
            if (!user) return res.status(404).json({ success: false, message: "Student not found" });

            const submissionStats = await dbGetAsync(
                `SELECT
                    COALESCE(SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass') THEN COALESCE(points_earned, 0) ELSE 0 END), 0) as earnedPoints,
                    COUNT(DISTINCT CASE WHEN LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass') THEN problem_id END) as solvedProblems,
                    MAX(
                        CASE
                            WHEN LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                            THEN (
                                SELECT COUNT(*) + 1
                                FROM users u
                                WHERE LOWER(COALESCE(u.role, '')) = 'student'
                                  AND COALESCE(u.points, 0) > COALESCE(?, 0)
                            )
                            ELSE NULL
                        END
                    ) as computedRank
                 FROM submissions
                 WHERE user_id = ?`,
                [user.points, studentId]
            );

            const recentSubmissions = await dbAllAsync(
                `SELECT
                    s.id,
                    COALESCE(p.title, 'Untitled Problem') as problemTitle,
                    COALESCE(p.difficulty, 'N/A') as difficulty,
                    COALESCE(s.language, 'N/A') as language,
                    COALESCE(s.status, 'pending') as status,
                    COALESCE(s.points_earned, 0) as pointsEarned,
                    COALESCE(s.createdAt, '') as createdAt
                 FROM submissions s
                 LEFT JOIN problems p ON p.id = s.problem_id
                 WHERE s.user_id = ?
                 ORDER BY datetime(COALESCE(s.createdAt, '1970-01-01')) DESC, s.id DESC
                 LIMIT 5`,
                [studentId]
            );

            const acceptedDays = await dbAllAsync(
                `SELECT DATE(COALESCE(createdAt, CURRENT_TIMESTAMP)) AS submitted_on
                 FROM submissions
                 WHERE user_id = ?
                   AND LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                 GROUP BY DATE(COALESCE(createdAt, CURRENT_TIMESTAMP))
                 ORDER BY submitted_on DESC`,
                [studentId]
            );

            const finalPoints = Number(user.points || submissionStats?.earnedPoints || 0);
            const finalSolvedCount = Number(user.solvedCount || submissionStats?.solvedProblems || 0);
            const rankNumber = Number(submissionStats?.computedRank || 0);
            const finalRank = user.rank || (rankNumber > 0 ? `#${rankNumber}` : 'Unranked');

            res.json({
                success: true,
                student: {
                    ...user,
                    points: finalPoints,
                    rank: finalRank,
                    solvedCount: finalSolvedCount,
                    streak: calculateConsecutiveDayStreak(acceptedDays.map((row) => row.submitted_on)),
                    level: Math.max(1, Math.floor(finalPoints / 150) + 1)
                },
                recentSubmissions
            });
        } catch (error) {
            console.error('Admin student public profile error:', error);
            res.status(500).json({ success: false, message: "Database error" });
        }
    });

    // ==========================================
    // UPDATE ADMIN PROFILE API
    // ==========================================
    router.put('/api/profile/update', requireRole('admin'), (req, res) => {
        const { fullName, password } = req.body;
        const userId = req.session.user.id;

        if (!fullName) {
            return res.status(400).json({ success: false, message: "Full name is required" });
        }

        if (password) {
            bcrypt.hash(password, 10, (err, hash) => {
                if (err) return res.status(500).json({ success: false, message: "Error hashing password" });
                
                db.run(
                    `UPDATE users SET fullName = ?, password = ? WHERE id = ?`,
                    [fullName, hash, userId],
                    function(err) {
                        if (err) return res.status(500).json({ success: false, message: "Database error" });
                        req.session.user.fullName = fullName; 
                        res.json({ success: true, message: "Profile and password updated successfully" });
                    }
                );
            });
        } else {
            db.run(
                `UPDATE users SET fullName = ? WHERE id = ?`,
                [fullName, userId],
                function(err) {
                    if (err) return res.status(500).json({ success: false, message: "Database error" });
                    req.session.user.fullName = fullName; 
                    res.json({ success: true, message: "Profile updated successfully" });
                }
            );
        }
    });
   // ⭐ BULK ACCEPT/REJECT USERS
    router.put('/api/users/bulk-status', requireRole('admin'), (req, res) => {
        const { userIds, status } = req.body;
        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ success: false, message: "No users selected" });
        }

        // Create placeholders (?, ?, ?) based on how many IDs are selected
        const placeholders = userIds.map(() => '?').join(',');
        
        // Dynamically set query to also assign is_verified properties if activating
        let query = `UPDATE users SET status = ? WHERE id IN (${placeholders}) AND collegeName = ?`;
        if (status === 'active') {
            query = `UPDATE users SET status = ?, is_verified = 1, isVerified = 1 WHERE id IN (${placeholders}) AND collegeName = ?`;
        }

        db.run(query, [status, ...userIds, req.session.user.collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: `Successfully updated ${this.changes} users to ${status}.` });
        });
    });

    // ⭐ BULK DELETE USERS (URL changed to prevent conflicts)
    router.delete('/api/bulk-delete-users', requireRole('admin'), (req, res) => {
        const { userIds } = req.body;
        
        // 1. Check if we received an array of IDs
        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ success: false, message: "No users selected" });
        }

        // 2. Create the exact number of placeholders (?, ?, ?) needed for the SQL query
        const placeholders = userIds.map(() => '?').join(',');
        
        // 3. Write the DELETE query. (We check collegeName to prevent deleting users from other colleges)
        const query = `DELETE FROM users WHERE id IN (${placeholders}) AND collegeName = ?`;

        // 4. Execute the query
        db.run(query, [...userIds, req.session.user.collegeName], function(err) {
            if (err) {
                console.error("Bulk delete error:", err);
                return res.status(500).json({ success: false, message: "Database error while deleting users." });
            }
            
            // this.changes tells us exactly how many rows were deleted
            if (this.changes === 0) {
                return res.json({ success: false, message: "No users were deleted. They may not exist or belong to your college." });
            }

            res.json({ success: true, message: `Successfully deleted ${this.changes} users.` });
        });
    });
    // ==========================================
    // ==========================================
    // ⭐ SETTINGS APIs (Security, Email & College Info)
    // ==========================================

    // 1. Update Password API
    router.post('/update-password', requireRole('admin'), async (req, res) => {
        const { currPass, newPass } = req.body;
        const userId = req.session.user.id;

        try {
            const user = await new Promise((resolve, reject) => {
                db.get(`SELECT password FROM users WHERE id = ?`, [userId], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });

            if (!user) return res.status(404).json({ success: false, message: "User not found" });

            // Verify current password
            const match = await bcrypt.compare(currPass, user.password);
            if (!match) return res.status(400).json({ success: false, message: "Current password is incorrect" });

            // Hash new password and update
            const hashedPassword = await bcrypt.hash(newPass, 10);
            db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashedPassword, userId], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, message: "Password updated successfully" });
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // 2. Update Email API
    router.post('/update-email', requireRole('admin'), async (req, res) => {
        res.status(403).json({ success: false, message: "Email update requires verification. Please request and verify the OTP first." });
    });

    // 3. Update College Info (University & Accreditation) API
    router.post('/update-college-info', requireRole('admin'), (req, res) => {
        const { university, accreditation } = req.body;
        const collegeName = String(req.session?.user?.collegeName || '').trim();

        if (!collegeName) {
            return res.status(400).json({ success: false, message: "No college is linked to this admin account." });
        }

        db.run(
            `INSERT OR IGNORE INTO colleges (name, university, accreditation, status) VALUES (?, '', '', 'active')`,
            [collegeName],
            (insertErr) => {
                if (insertErr) return res.status(500).json({ success: false, message: insertErr.message });

                db.run(
                    `UPDATE colleges SET university = ?, accreditation = ? WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`,
                    [String(university || '').trim(), String(accreditation || '').trim(), collegeName],
                    function(err) {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        res.json({ success: true, message: "College Info updated successfully" });
                    }
                );
            }
        );
    });

    router.get('/college-info-options', requireRole('admin'), async (req, res) => {
        try {
            const [universities, accreditations] = await Promise.all([
                dbAllAsync(`SELECT DISTINCT TRIM(COALESCE(university, '')) AS value FROM colleges WHERE TRIM(COALESCE(university, '')) != '' ORDER BY value COLLATE NOCASE ASC`),
                dbAllAsync(`SELECT DISTINCT TRIM(COALESCE(accreditation, '')) AS value FROM colleges WHERE TRIM(COALESCE(accreditation, '')) != '' ORDER BY value COLLATE NOCASE ASC`)
            ]);

            res.json({
                success: true,
                universities: universities.map(row => row.value).filter(Boolean),
                accreditations: accreditations.map(row => row.value).filter(Boolean)
            });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    return router;
};
