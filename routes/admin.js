const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt'); // Added for secure password hashing
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

// ⭐ Updated: Now accepts transporter as the second argument
module.exports = (db, transporter) => {
    const router = express.Router();

    // ==========================================
    // ⭐ METADATA API (For Registration Dropdowns)
    // ==========================================
    router.get('/api/metadata', (req, res) => {
        db.all(`SELECT name FROM branches`, [], (errDept, deptRows) => {
            let departments = ['CSE', 'IT', 'ECE', 'ME', 'Civil']; 
            if (!errDept && deptRows && deptRows.length > 0) {
                departments = [...new Set(deptRows.map(row => row.name))];
            }

            db.all(`SELECT name FROM designations`, [], (errDesig, desigRows) => {
                let designations = ['Assistant Professor', 'Professor']; 
                if (!errDesig && desigRows && desigRows.length > 0) {
                    designations = [...new Set(desigRows.map(row => row.name))];
                }

                res.json({ success: true, departments, designations });
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

    // ⭐ ADDED: Profile and Help/Support View Routes
    router.get('/profile', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/profile.html'));
    });

    router.get('/help_support', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/help_support.html'));
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
    
    // ⭐ ADDED: Profile and Help/Support Alias Routes
    router.get('/profile.html', requireRole('admin'), (req, res) => res.redirect('/college/profile'));
    router.get('/help_support.html', requireRole('admin'), (req, res) => res.redirect('/college/help_support'));
    router.get('/help-support', requireRole('admin'), (req, res) => res.redirect('/college/help_support'));
    router.get('/help-support.html', requireRole('admin'), (req, res) => res.redirect('/college/help_support'));

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
    // ⭐ SETTINGS & PROFILE APIs (New)
    // ==========================================

    router.get('/api/profile', requireRole('admin'), (req, res) => {
        const userId = req.session.user.id;
        db.get(`SELECT id, fullName, email, role, collegeName FROM users WHERE id = ?`, [userId], (err, user) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            
            if (user) {
                const parts = (user.fullName || '').split(' ');
                user.firstName = parts[0];
                user.lastName = parts.slice(1).join(' ');
            }
            res.json({ success: true, user });
        });
    });

    // ⭐ Dashboard Analytics & Feed APIs
    router.get('/api/activity-stats', requireRole('admin'), (req, res) => {
        // Mocking chart data based on months
        res.json({
            labels: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
            data: [45, 52, 38, 65, 48, 72]
        });
    });

    router.get('/api/activity', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        // Fetch recent users as activity
        db.all(`SELECT fullName, role, createdAt FROM users WHERE collegeName = ? ORDER BY id DESC LIMIT 5`, [collegeName], (err, rows) => {
            if (err) return res.json([]);
            const activities = rows.map(r => ({
                message: `New ${r.role} onboarded: ${r.fullName}`,
                time: 'Recently',
                icon: r.role === 'student' ? 'fa-solid fa-graduation-cap' : 'fa-solid fa-chalkboard-user'
            }));
            res.json(activities);
        });
    });

    router.get('/api/alerts', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        // Pending faculty requests as alerts
        db.all(`SELECT id, fullName FROM users WHERE collegeName = ? AND role = 'pending' AND status = 'pending'`, [collegeName], (err, rows) => {
            if (err) return res.json([]);
            const alerts = rows.map(r => ({
                message: `Verification required for faculty: ${r.fullName}`,
                type: 'warning'
            }));
            res.json(alerts);
        });
    });

    router.post('/send-email-update-otp', requireRole('admin'), (req, res) => {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: "Email is required" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore.set(`email_${req.session.user.id}`, { email, otp, expiresAt: Date.now() + 5 * 60 * 1000 });
        
        console.log(`[DEV MODE] Email Update OTP for ${email}: ${otp}`);
        
        // ⭐ Send the email via Nodemailer
        if (transporter) {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'CampusCode - Email Update OTP',
                html: `
                    <div style="font-family: sans-serif; padding: 20px;">
                        <h2>Email Update Request</h2>
                        <p>Your OTP to verify your new email address is: <strong style="font-size: 24px; color: #1E4A7A;">${otp}</strong></p>
                        <p>This code is valid for 5 minutes.</p>
                    </div>
                `
            };
            transporter.sendMail(mailOptions).catch(err => console.error('Failed to send OTP email:', err));
        }

        res.json({ success: true, message: "OTP sent successfully" });
    });

    router.post('/verify-email-otp', requireRole('admin'), (req, res) => {
        const { email, otp } = req.body;
        const userId = req.session.user.id;
        const stored = otpStore.get(`email_${userId}`);

        if (!stored || stored.otp !== otp || stored.expiresAt < Date.now() || stored.email !== email) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        otpStore.delete(`email_${userId}`);

        db.run(`UPDATE users SET email = ? WHERE id = ?`, [email, userId], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            req.session.user.email = email;
            res.json({ success: true, message: "Email updated successfully" });
        });
    });

    router.post('/forgot-password-otp', requireRole('admin'), (req, res) => {
        const email = req.session.user.email; 
        if (!email) return res.status(400).json({ success: false, message: "No email on record." });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore.set(`fp_${req.session.user.id}`, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
        
        console.log(`[DEV MODE] Forgot Password OTP for ${email}: ${otp}`);
        
        // ⭐ Send the email via Nodemailer
        if (transporter) {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'CampusCode - Password Reset OTP',
                html: `
                    <div style="font-family: sans-serif; padding: 20px;">
                        <h2>Password Reset Request</h2>
                        <p>Your OTP to reset your password is: <strong style="font-size: 24px; color: #1E4A7A;">${otp}</strong></p>
                        <p>This code is valid for 5 minutes. If you didn't request this, please ignore this email.</p>
                    </div>
                `
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

    router.post('/update-profile', requireRole('admin'), async (req, res) => {
        const { fullName, email, designation, currPass, newPass } = req.body;
        const userId = req.session.user.id;

        try {
            if (newPass && newPass.trim() !== '') {
                // Changing password requires verifying current password
                const user = await new Promise((resolve, reject) => {
                    db.get(`SELECT password FROM users WHERE id = ?`, [userId], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });

                const match = await bcrypt.compare(currPass, user.password);
                if (!match) return res.status(400).json({ success: false, message: "Current password is incorrect" });

                const hashedPassword = await bcrypt.hash(newPass, 10);
                
                db.run(`UPDATE users SET fullName = ?, designation = ?, password = ? WHERE id = ?`, 
                    [fullName, designation || null, hashedPassword, userId], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: "Profile and password updated successfully" });
                });
            } else {
                // Updating profile without password
                db.run(`UPDATE users SET fullName = ?, designation = ? WHERE id = ?`, 
                    [fullName, designation || null, userId], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: "Profile updated successfully" });
                });
            }
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // ==========================================
    // ADMIN APIs (Manage Users in their College)
    // ==========================================
    
    router.get('/api/pending-faculty', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.all(`SELECT id, fullName, email, branch FROM users WHERE collegeName = ? AND role = 'pending' AND status = 'pending'`, 
        [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, pending: rows });
        });
    });

    router.post('/api/approve-faculty/:id', requireRole('admin'), (req, res) => {
        const { course, branch } = req.body;
        const collegeName = req.session.user.collegeName;
        
        if (!course || !branch) {
            return res.status(400).json({ success: false, error: "Course and Branch are required." });
        }

        db.run(`UPDATE users SET status = 'active', is_verified = 1, isVerified = 1, course = ?, branch = ?, department = ?, role = 'faculty' WHERE id = ? AND collegeName = ? AND role = 'pending'`, 
        [course, branch, branch, req.params.id, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (this.changes === 0) return res.status(404).json({ success: false, error: "User not found or not in pending state." });
            res.json({ success: true, message: 'User verified and assigned successfully' });
        });
    });

    router.get('/api/users', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        
        const query = `
            SELECT 
                u.*,
                0 AS contests_participated,
                0 AS problems_solved,
                0 AS contests_won,
                0 AS streak,
                '-' AS college_rank,
                '-' AS global_rank,
                1 AS level,
                (SELECT COUNT(*) FROM contests WHERE createdBy = u.id AND status = 'accepted') AS contests_created,
                (SELECT COUNT(*) FROM problems WHERE faculty_id = u.id AND status = 'accepted') AS problems_created,
                '0.0' AS rating
            FROM users u
            WHERE u.collegeName = ? AND u.role IN ('student', 'faculty', 'hod', 'hos') AND u.status = 'active'
            ORDER BY u.id DESC
        `;

        db.all(query, [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, users: rows });
        });
    });

    router.post('/api/users/bulk', requireRole('admin'), async (req, res) => {
        const { users } = req.body;
        const collegeName = req.session.user.collegeName;

        if (!users || !Array.isArray(users)) {
            return res.status(400).json({ success: false, message: "Invalid data format." });
        }

        let successCount = 0;
        let failCount = 0;

        for (let user of users) {
            try {
                // Check if email exists
                const existing = await new Promise((resolve, reject) => {
                    db.get(`SELECT id FROM users WHERE email = ?`, [user.email], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });

                if (existing) { failCount++; continue; }

                // Check HOD conflict if applicable (using branch)
                if (user.role === 'faculty' && user.is_hod === 1) {
                    const hodExists = await checkHODExists(db, collegeName, user.branch);
                    if (hodExists) { user.is_hod = 0; } 
                }

                // ⭐ Changed default password to CAMPUS123
                const plainPassword = user.defaultPassword || "CAMPUS123";
                const hashedPassword = await bcrypt.hash(plainPassword, 10);

                await new Promise((resolve, reject) => {
                    db.run(`INSERT INTO users (role, fullName, email, password, collegeName, branch, department, is_hod, status, program, course, year, section) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
                        [user.role, user.fullName, user.email, hashedPassword, collegeName, user.branch || null, user.branch || null, user.is_hod || 0, user.program || null, user.program || null, user.year || null, user.section || null],
                        function(err) { if (err) reject(err); else resolve(); }
                    );
                });
                
                // ⭐ Send Welcome Email for bulk user
                if (transporter) {
                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: user.email,
                        subject: 'Welcome to CampusCode!',
                        html: `
                            <div style="font-family: sans-serif; padding: 20px;">
                                <h2>Hello ${user.fullName},</h2>
                                <p>You have been onboarded to CampusCode as a <strong>${user.role}</strong>.</p>
                                <p>Your login credentials are:</p>
                                <ul>
                                    <li><strong>Email:</strong> ${user.email}</li>
                                    <li><strong>Password:</strong> ${plainPassword}</li>
                                </ul>
                                <p>We strongly recommend changing your password after logging in!</p>
                            </div>
                        `
                    };
                    transporter.sendMail(mailOptions).catch(err => console.error('Bulk welcome email failed:', err));
                }

                successCount++;
            } catch (error) {
                console.error("Bulk Insert Error:", error);
                failCount++;
            }
        }
        res.json({ success: true, message: `Upload finished! ✅ Added: ${successCount}, ❌ Skipped/Failed: ${failCount}` });
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

                // ⭐ Changed default password to CAMPUS123
                const plainPassword = password || "CAMPUS123";
                const hashedPassword = await bcrypt.hash(plainPassword, 10);

                db.run(`INSERT INTO users (role, fullName, email, password, collegeName, branch, department, is_hod, status, program, course, year, section) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`, 
                    [role, fullName, email, hashedPassword, collegeName, branch || null, branch || null, is_hod || 0, program || null, program || null, year || null, section || null], function(err) {
                        if (err) return res.status(500).json({ success: false, error: err.message });
                        
                        // ⭐ Send Welcome Email for single user
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

            let query = `UPDATE users SET fullName = ?, email = ?, role = ?, branch = ?, department = ?, is_hod = ?, program = ?, course = ?, year = ?, section = ?`;
            let params = [fullName, email, role, branch || null, branch || null, is_hod || 0, program || null, program || null, year || null, section || null];

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
                        
                        // ⭐ Automated HOD Sync based on Branch Structure
                        const syncQuery = `
                            INSERT OR IGNORE INTO user_assignments (user_id, subject, year, section, assigned_by_id, collegeName)
                            SELECT ?, sub.name, 
                                   CASE 
                                     WHEN s.semester <= 2 THEN '1st Year' 
                                     WHEN s.semester <= 4 THEN '2nd Year' 
                                     WHEN s.semester <= 6 THEN '3rd Year' 
                                     ELSE '4th Year' 
                                   END,
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
    // ACADEMIC STRUCTURE APIs
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
            SELECT b.*, p.name as program_name 
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
            SELECT s.*, b.name as branch_name 
            FROM sections s 
            JOIN branches b ON s.branch_id = b.id
            JOIN programs p ON b.program_id = p.id
            WHERE p.collegeName = ? OR p.collegeName IS NULL
        `;
        db.all(query, [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.get('/subjects', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        const query = `
            SELECT sub.*, s.semester, b.name as branch_name, p.name as program_name
            FROM subjects sub
            JOIN sections s ON sub.section_id = s.id
            JOIN branches b ON s.branch_id = b.id
            JOIN programs p ON b.program_id = p.id
            WHERE p.collegeName = ? OR p.collegeName IS NULL
        `;
        db.all(query, [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    router.post('/add-program', requireRole('admin'), (req, res) => {
        const { name, code, type, duration } = req.body;
        const collegeName = req.session.user.collegeName; 
        
        db.run(`INSERT INTO programs (collegeName, name, code, type, duration) VALUES (?, ?, ?, ?, ?)`, 
            [collegeName, name, code, type, duration], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, id: this.lastID });
        });
    });

    router.post('/add-branch', requireRole('admin'), (req, res) => {
        const { program_id, name, code, abbreviation } = req.body;
        const collegeName = req.session.user.collegeName;
        db.run(`INSERT INTO branches (program_id, name, code, abbreviation, collegeName) VALUES (?, ?, ?, ?, ?)`, 
            [program_id, name, code, abbreviation, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, id: this.lastID });
        });
    });

    router.post('/add-section', requireRole('admin'), (req, res) => {
        const { branch_id, name, semester, capacity } = req.body;
        const collegeName = req.session.user.collegeName;
        db.run(`INSERT INTO sections (branch_id, name, semester, capacity, collegeName) VALUES (?, ?, ?, ?, ?)`, 
            [branch_id, name, semester, capacity, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, id: this.lastID });
        });
    });

    router.post('/add-subject', requireRole('admin'), (req, res) => {
        const { section_id, name, code, credits } = req.body;
        const collegeName = req.session.user.collegeName;
        db.run(`INSERT INTO subjects (section_id, name, code, credits, collegeName) VALUES (?, ?, ?, ?, ?)`, 
            [section_id, name, code, credits, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, id: this.lastID });
        });
    });

    router.post('/edit-program', requireRole('admin'), (req, res) => {
        const { id, name, code, type, duration } = req.body;
        const collegeName = req.session.user.collegeName;
        
        db.run(`UPDATE programs SET name=?, code=?, type=?, duration=? WHERE id=? AND collegeName=?`, 
            [name, code, type, duration, id, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.post('/edit-branch', requireRole('admin'), (req, res) => {
        const { id, program_id, name, code, abbreviation } = req.body;
        db.run(`UPDATE branches SET program_id=?, name=?, code=?, abbreviation=? WHERE id=?`, 
            [program_id, name, code, abbreviation, id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.post('/edit-section', requireRole('admin'), (req, res) => {
        const { id, branch_id, name, semester, capacity } = req.body;
        db.run(`UPDATE sections SET branch_id=?, name=?, semester=?, capacity=? WHERE id=?`, 
            [branch_id, name, semester, capacity, id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.post('/edit-subject', requireRole('admin'), (req, res) => {
        const { id, section_id, name, code, credits } = req.body;
        db.run(`UPDATE subjects SET section_id=?, name=?, code=?, credits=? WHERE id=?`, 
            [section_id, name, code, credits, id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
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

    // --- PUT UPDATES ---
    router.put('/update-program/:id', requireRole('admin'), (req, res) => {
        const { name, code, type, duration } = req.body;
        const collegeName = req.session.user.collegeName;
        db.run(`UPDATE programs SET name=?, code=?, type=?, duration=? WHERE id=? AND collegeName=?`, 
            [name, code, type, duration, req.params.id, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.put('/update-branch/:id', requireRole('admin'), (req, res) => {
        const { name, code, abbreviation } = req.body;
        db.run(`UPDATE branches SET name=?, code=?, abbreviation=? WHERE id=?`, 
            [name, code, abbreviation, req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.put('/update-section/:id', requireRole('admin'), (req, res) => {
        const { name, semester, capacity } = req.body;
        db.run(`UPDATE sections SET name=?, semester=?, capacity=? WHERE id=?`, 
            [name, semester, capacity, req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.put('/update-subject/:id', requireRole('admin'), (req, res) => {
        const { name, code, credits } = req.body;
        db.run(`UPDATE subjects SET name=?, code=?, credits=? WHERE id=?`, 
            [name, code, credits, req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    // ==========================================
    // CONTESTS & PROBLEMS APIs
    // ==========================================

    router.get('/api/contests', requireRole('admin'), (req, res) => {
        db.all(`SELECT * FROM contests ORDER BY id DESC`, [], (err, rows) => {
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

    router.post('/api/contests', requireRole('admin'), (req, res) => {
        const { title, scope, level, date, deadline, duration, eligibility, description, rulesAndDescription, colleges, problem_ids } = req.body;
        const collegesStr = colleges ? JSON.stringify(colleges) : '[]';
        const createdBy = req.session.user.id;
        const collegeName = req.session.user.collegeName;

        // Admin contests are auto-accepted — no HOD/HOS verification needed
        db.run(`INSERT INTO contests (title, scope, level, date, deadline, duration, eligibility, description, rulesAndDescription, status, colleges, createdBy, collegeName, hos_verified, hod_verified) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, 1, 1)`, 
            [title, scope, level, date, deadline, duration, eligibility, description, rulesAndDescription, collegesStr, createdBy, collegeName], 
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
        db.all(`SELECT * FROM problems ORDER BY id DESC`, [], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    // I completed the bottom part of this route since it got cut off in your snippet
    router.post('/api/problems', requireRole('admin'), (req, res) => {
        const { title, difficulty, score, constraints, description } = req.body;
        
        db.run(`INSERT INTO problems (title, difficulty, score, constraints, description) 
                VALUES (?, ?, ?, ?, ?)`, 
            [title, difficulty, score, constraints, description], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, id: this.lastID, message: "Problem created successfully!" });
            });
    });

    router.put('/api/contests/:id', requireRole('admin'), (req, res) => {
        const { title, scope, level, date, deadline, duration, eligibility, description, rulesAndDescription, status, colleges } = req.body;
        const collegesStr = colleges ? JSON.stringify(colleges) : '[]';

        db.run(`UPDATE contests SET title=?, scope=?, level=?, date=?, deadline=?, duration=?, eligibility=?, description=?, rulesAndDescription=?, status=?, colleges=? WHERE id=?`, 
            [title, scope, level, date, deadline, duration, eligibility, description, rulesAndDescription, status || 'upcoming', collegesStr, req.params.id], 
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
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
        db.all(`SELECT id, fullName, email, collegeName FROM users WHERE is_verified = 0 AND role = 'pending' AND collegeName = ?`, [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, pending: rows });
        });
    });

    router.post('/api/verify-user', requireRole('admin'), (req, res) => {
        const { userId, course, branch } = req.body;
        const collegeName = req.session.user.collegeName;

        if (!course || !branch) {
            return res.status(400).json({ success: false, error: "Course and Branch are required." });
        }

        db.run(`UPDATE users SET is_verified = 1, isVerified = 1, role = 'faculty', status = 'active', course = ?, branch = ?, department = ? WHERE id = ? AND collegeName = ?`,
            [course, branch, branch, userId, collegeName], function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, error: "User not found or already verified." });
                res.json({ success: true, message: "User verified as faculty successfully!" });
            });
    });

    return router;
};