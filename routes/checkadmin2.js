const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt'); // Added for secure password hashing
const { requireRole } = require('../middleware/auth');

// ⭐ In-memory store for OTPs (email -> { otp, expiresAt })
const otpStore = new Map();

// ⭐ Helper function to check for existing HOD using 'branch'
const checkHODExists = (db, collegeName, branch, excludeUserId = null) => {
    return new Promise((resolve, reject) => {
        let query = `SELECT id FROM account_users WHERE collegeName = ? AND branch = ? AND is_hod = 1 AND status = 'active'`;
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

    // ⭐ ADDED: Profile, Help/Support, and View Faculty Routes
    router.get('/profile', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/profile.html'));
    });

    router.get('/help_support', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/help_support.html'));
    });

    router.get('/view_faculty', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/faculty/view_faculty.html'));
    });
    // 👇 ADD THESE NEW VIEW STUDENT ROUTES HERE 👇
    router.get('/view_student', requireRole('admin'), (req, res) => {
    
        res.sendFile(path.join(__dirname, '../views/student/view_student.html'));
    });

    // Add smart alias so /view_student.html redirects to the clean URL
    router.get('/view_student.html', requireRole('admin'), (req, res) => {
        res.redirect('/college/view_student');
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
        db.get(`SELECT id, fullName, email, role, collegeName FROM account_users WHERE id = ?`, [userId], (err, user) => {
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
        const collegeName = req.session.user.collegeName;
        
        // Query to group users by creation month for the last 6 months
        // Note: SQLite strftime('%Y-%m') gets the Year-Month string
        const query = `
            SELECT 
                strftime('%m', createdAt) as month_num,
                COUNT(*) as count
            FROM account_users 
            WHERE collegeName = ? 
              AND createdAt >= date('now', '-6 months')
            GROUP BY month_num
            ORDER BY createdAt ASC
        `;

        db.all(query, [collegeName], (err, rows) => {
            if (err) {
                console.error("Error fetching stats:", err);
                // Fallback data if error
                return res.json({ labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], data: [0, 0, 0, 0, 0, 0] });
            }

            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            
            // Map the results to labels and data
            const labels = rows.map(r => monthNames[parseInt(r.month_num, 10) - 1] || 'Unknown');
            const data = rows.map(r => r.count);

            res.json({ labels, data });
        });
    });

    router.post('/send-email-update-otp', requireRole('admin'), (req, res) => {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: "Email is required" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore.set(`email_${req.session.user.id}`, { email, otp, expiresAt: Date.now() + 5 * 60 * 1000 });
        
        console.log(`[DEV MODE] Email Update OTP for ${email}: ${otp}`);
        
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

        db.run(`UPDATE account_users SET email = ? WHERE id = ?`, [email, userId], function(err) {
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
            db.run(`UPDATE account_users SET password = ? WHERE id = ?`, [hashedPassword, userId], function(err) {
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
                const user = await new Promise((resolve, reject) => {
                    db.get(`SELECT password FROM account_users WHERE id = ?`, [userId], (err, row) => {
                        if (err) reject(err); else resolve(row);
                    });
                });

                const match = await bcrypt.compare(currPass, user.password);
                if (!match) return res.status(400).json({ success: false, message: "Current password is incorrect" });

                const hashedPassword = await bcrypt.hash(newPass, 10);
                
                db.run(`UPDATE account_users SET fullName = ?, designation = ?, password = ? WHERE id = ?`, 
                    [fullName, designation || null, hashedPassword, userId], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: "Profile and password updated successfully" });
                });
            } else {
                db.run(`UPDATE account_users SET fullName = ?, designation = ? WHERE id = ?`, 
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
        db.all(`
            SELECT id, fullName, email, branch, role, 'account' as request_type
            FROM account_users
            WHERE collegeName = ? AND status = 'pending'
            UNION ALL
            SELECT id, fullName, email, branch, role, 'college_change' as request_type
            FROM account_users
            WHERE role = 'student' AND pending_college_name = ? AND college_request_status = 'pending'
        `, 
        [collegeName, collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, pending: rows });
        });
    });

    router.post('/api/approve-faculty/:id', requireRole('admin'), (req, res) => {
        const { course, branch, role } = req.body; 
        const collegeName = req.session.user.collegeName;

        db.get(`SELECT id, role, status, collegeName, pending_college_name, college_request_status FROM account_users WHERE id = ?`, [req.params.id], (userErr, userRow) => {
            if (userErr) return res.status(500).json({ success: false, error: userErr.message });
            if (!userRow) return res.status(404).json({ success: false, error: 'User not found.' });

            const isStudentCollegeRequest = String(userRow.role || '').toLowerCase() === 'student'
                && String(userRow.college_request_status || '').toLowerCase() === 'pending'
                && String(userRow.pending_college_name || '') === String(collegeName || '');

            if (isStudentCollegeRequest) {
                db.run(`
                    UPDATE account_users
                    SET collegeName = pending_college_name,
                        pending_college_name = '',
                        college_request_status = 'approved',
                        status = 'active',
                        is_verified = 1,
                        isVerified = 1
                    WHERE id = ?
                `, [req.params.id], function (approveErr) {
                    if (approveErr) return res.status(500).json({ success: false, error: approveErr.message });
                    return res.json({ success: true, message: 'Student college verification approved successfully.' });
                });
                return;
            }

            if (!course || !branch) {
                return res.status(400).json({ success: false, error: "Course and Branch are required." });
            }

            const assignedRole = role || null;
            db.run(`UPDATE account_users SET status = 'active', is_verified = 1, isVerified = 1, course = ?, branch = ?, department = ?, role = COALESCE(?, role) WHERE id = ? AND collegeName = ?`, 
            [course, branch, branch, assignedRole, req.params.id, collegeName], function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, error: "User not found or not in pending state." });
                res.json({ success: true, message: 'User verified and assigned successfully' });
            });
        });
    });

    router.get('/api/users', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        
        const query = `
            SELECT 
                u.*,
                CASE WHEN LOWER(COALESCE(u.role,'')) = 'hod' THEN 1 ELSE COALESCE(u.is_hod, 0) END AS is_hod,
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
            FROM account_users u
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

        if (!users || !Array.isArray(users) || users.length === 0) {
            return res.status(400).json({ success: false, error: "No valid user data provided." });
        }

        let successCount = 0;
        let errors = [];

        for (const user of users) {
            try {
                const hashedPassword = await bcrypt.hash(user.defaultPassword, 10);
                
                await new Promise((resolve, reject) => {
                    db.run(`INSERT INTO account_users (fullName, email, role, password, collegeName, program, branch, department, year, section, status, is_verified, isVerified) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 1)`,
                    [
                        user.fullName, 
                        user.email, 
                        user.role, 
                        hashedPassword, 
                        collegeName, 
                        user.program, 
                        user.branch, 
                        user.branch, 
                        user.year, 
                        user.section
                    ], function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                });
                successCount++;
            } catch (err) {
                if (!err.message.includes('UNIQUE constraint failed')) {
                    errors.push(`Failed for ${user.email}: ${err.message}`);
                }
            }
        }

        res.json({ 
            success: true, 
            message: `Successfully imported ${successCount} users.`, 
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

            db.get(`SELECT id FROM account_users WHERE email = ?`, [email], async (err, existing) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (existing) return res.status(409).json({ success: false, error: "Email already in use." });

                if (role === 'faculty' && is_hod === 1) {
                    const exists = await checkHODExists(db, collegeName, branch);
                    if (exists) {
                        return res.status(400).json({ success: false, error: `An HOD already exists for the ${branch} branch.` });
                    }
                }

                const plainPassword = password || "CAMPUS123";
                const hashedPassword = await bcrypt.hash(plainPassword, 10);

                db.run(`INSERT INTO account_users (role, fullName, email, password, collegeName, branch, department, is_hod, status, program, course, year, section) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`, 
                    [role, fullName, email, hashedPassword, collegeName, branch || null, branch || null, is_hod || 0, program || null, program || null, year || null, section || null], function(err) {
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

            let query = `UPDATE account_users SET fullName = ?, email = ?, role = ?, branch = ?, department = ?, is_hod = ?, program = ?, course = ?, year = ?, section = ?`;
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
        const targetIsHod = Number(is_hod) === 1 ? 1 : 0;
        const userId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            if (targetIsHod === 1) {
                db.get(`SELECT branch, department, fullName, role, is_hod FROM account_users WHERE id = ? AND collegeName = ?`, [userId, collegeName], async (err, facultyUser) => {
                    if (err || !facultyUser) return res.status(404).json({ success: false, error: 'User not found' });
                    const currentRole = String(facultyUser.role || '').trim().toLowerCase();
                    if (['student', 'superadmin'].includes(currentRole)) {
                        return res.status(400).json({ success: false, error: `Cannot promote role "${facultyUser.role || 'unknown'}" to HOD.` });
                    }
                    if (currentRole === 'hod' && Number(facultyUser.is_hod) === 1) {
                        return res.json({ success: true, message: 'User is already marked as HOD.' });
                    }
                    const normalizedBranch = String(facultyUser.branch || facultyUser.department || '').trim();
                    if (!normalizedBranch) {
                        return res.status(400).json({ success: false, error: 'Faculty branch/department is missing. Please update profile first.' });
                    }
                    
                    const exists = await checkHODExists(db, collegeName, normalizedBranch, userId);
                    if (exists) return res.status(400).json({ success: false, error: `An HOD already exists for the ${normalizedBranch} branch.` });

                    db.run(`UPDATE account_users SET is_hod = 1, role = 'hod', branch = ?, department = ? WHERE id = ? AND collegeName = ?`, [normalizedBranch, normalizedBranch, userId, collegeName], (err) => {
                        if (err) return res.status(500).json({ success: false, error: err.message });
                        
                        const syncQuery = `
                            INSERT OR IGNORE INTO faculty_assignments (user_id, subject, year, section, assigned_by_id, collegeName)
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

                        db.run(syncQuery, [userId, req.session.user.id, collegeName, collegeName, normalizedBranch, normalizedBranch], (err) => {
                            if (err) console.error("HOD Sync Error:", err);
                            res.json({ success: true, message: `HOD status granted and ${normalizedBranch} structure synced.` });
                        });
                    });
                });
            } else {
                db.run(`UPDATE account_users SET is_hod = 0, role = CASE WHEN LOWER(COALESCE(role,''))='hod' THEN 'faculty' ELSE role END WHERE id = ? AND collegeName = ?`, [userId, collegeName], (err) => {
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
        db.run(`DELETE FROM account_users WHERE id = ? AND collegeName = ?`, [req.params.id, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, message: 'User deleted successfully' });
        });
    });

    // ==========================================
    // ⭐ ACADEMIC STRUCTURE APIs (Updated Hierarchies)
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
        
        db.run(`INSERT INTO programs (collegeName, name, code, type, duration) VALUES (?, ?, ?, ?, ?)`, 
            [collegeName, name, code, type, duration], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, id: this.lastID, message: "Program added!" });
        });
    });

    router.post('/add-branch', requireRole('admin'), (req, res) => {
        const { program_id, name, code, abbreviation } = req.body;
        const collegeName = req.session.user.collegeName;
        db.run(`INSERT INTO branches (program_id, name, code, abbreviation, collegeName) VALUES (?, ?, ?, ?, ?)`, 
            [program_id, name, code, abbreviation, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, id: this.lastID, message: "Branch added!" });
        });
    });

    // ⭐ FIXED: Added semester and capacity fields
    router.post('/add-section', requireRole('admin'), (req, res) => {
        const { branch_id, name, year, semester, capacity } = req.body;
        const collegeName = req.session.user.collegeName;
        db.run(`INSERT INTO sections (branch_id, name, year, semester, capacity, collegeName) VALUES (?, ?, ?, ?, ?, ?)`, 
            [branch_id, name, year, semester || null, capacity || null, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, id: this.lastID, message: "Section added!" });
        });
    });

    // ⭐ FIXED: Add Subject dynamically fetches Year and Semester
    router.post('/add-subject', requireRole('admin'), (req, res) => {
        const { branch_id, section_id, name, code, credits } = req.body;
        const collegeName = req.session.user.collegeName;

        db.get(`SELECT year, semester FROM sections WHERE id = ?`, [section_id], (err, section) => {
            const finalYear = (section && section.year) ? section.year : 1; 
            const finalSemester = (section && section.semester) ? section.semester : 1;

            db.run(`INSERT INTO subjects (branch_id, section_id, name, code, credits, year, semester, collegeName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                [branch_id, section_id || null, name, code, credits, finalYear, finalSemester, collegeName], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, id: this.lastID, message: "Subject added!" });
            });
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

    // ⭐ FIXED: Added semester and capacity fields
    router.post('/edit-section', requireRole('admin'), (req, res) => {
        const { id, branch_id, name, year, semester, capacity } = req.body;
        db.run(`UPDATE sections SET branch_id=?, name=?, year=?, semester=?, capacity=? WHERE id=?`, 
            [branch_id, name, year, semester || null, capacity || null, id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    // ⭐ FIXED: Edit Subject dynamically fetches Year and Semester
    router.post('/edit-subject', requireRole('admin'), (req, res) => {
        const { id, branch_id, section_id, name, code, credits } = req.body;

        db.get(`SELECT year, semester FROM sections WHERE id = ?`, [section_id], (err, section) => {
            const finalYear = (section && section.year) ? section.year : 1; 
            const finalSemester = (section && section.semester) ? section.semester : 1;

            db.run(`UPDATE subjects SET branch_id=?, section_id=?, name=?, code=?, credits=?, year=?, semester=? WHERE id=?`, 
                [branch_id, section_id || null, name, code, credits, finalYear, finalSemester, id], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true });
            });
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

    // ⭐ FIXED: Added semester and capacity fields for PUT update
    router.put('/update-section/:id', requireRole('admin'), (req, res) => {
        const { name, year, semester, capacity } = req.body;
        db.run(`UPDATE sections SET name=?, year=?, semester=?, capacity=? WHERE id=?`, 
            [name, year, semester || null, capacity || null, req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    // ⭐ FIXED: Update Subject dynamically fetches Year and Semester
    router.put('/update-subject/:id', requireRole('admin'), (req, res) => {
        const { name, code, credits, section_id } = req.body;
        
        db.get(`SELECT year, semester FROM sections WHERE id = ?`, [section_id], (err, section) => {
            const finalYear = (section && section.year) ? section.year : 1;
            const finalSemester = (section && section.semester) ? section.semester : 1;

            db.run(`UPDATE subjects SET name=?, code=?, credits=?, section_id=?, year=?, semester=? WHERE id=?`, 
                [name, code, credits, section_id || null, finalYear, finalSemester, req.params.id], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true });
            });
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
        const {
            title, scope, level, date, deadline, duration, eligibility, description, discription,
            rulesAndDescription, guidelines, colleges, problem_ids, prize, class: contestClassInput, contest_class,
            startDate, endDate
        } = req.body;
        const collegesStr = colleges ? JSON.stringify(colleges) : '[]';
        const createdBy = req.session.user.id;
        const collegeName = req.session.user.collegeName;
        const normalizedClass = ['E', 'D', 'C', 'B', 'A', 'S'].includes(String(contestClassInput || contest_class || '').toUpperCase())
            ? String(contestClassInput || contest_class).toUpperCase()
            : 'E';
        const finalDescription = description || discription || '';
        const finalGuidelines = guidelines || rulesAndDescription || '';
        const finalStartDate = startDate || date || null;
        const finalEndDate = endDate || deadline || null;

        db.run(`INSERT INTO contests (
                    title, scope, level, date, deadline, duration, eligibility, description, rulesAndDescription,
                    guidelines, contest_class, prize, startDate, endDate,
                    status, colleges, createdBy, collegeName, hos_verified, hod_verified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, 1, 1)`,
            [
                title, scope, level, date, deadline, duration, eligibility, finalDescription, finalGuidelines,
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
        db.all(`SELECT * FROM problems ORDER BY id DESC`, [], (err, rows) => {
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
        const normalizedClass = ['E', 'D', 'C', 'B', 'A', 'S'].includes(String(contestClassInput || contest_class || '').toUpperCase())
            ? String(contestClassInput || contest_class).toUpperCase()
            : 'E';
        const finalDescription = description || discription || '';
        const finalGuidelines = guidelines || rulesAndDescription || '';
        const finalStartDate = startDate || date || null;
        const finalEndDate = endDate || deadline || null;

        db.run(`UPDATE contests
                SET title=?, scope=?, level=?, date=?, deadline=?, duration=?, eligibility=?, description=?, rulesAndDescription=?,
                    guidelines=?, contest_class=?, prize=?, startDate=?, endDate=?, status=?, colleges=?
                WHERE id=?`,
            [
                title, scope, level, date, deadline, duration, eligibility, finalDescription, finalGuidelines,
                finalGuidelines, normalizedClass, prize || '', finalStartDate, finalEndDate, status || 'upcoming', collegesStr, req.params.id
            ],
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
        db.all(`SELECT id, fullName, email, collegeName, role FROM account_users WHERE is_verified = 0 AND status = 'pending' AND collegeName = ?`, [collegeName], (err, rows) => {
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

        db.run(`UPDATE account_users SET is_verified = 1, isVerified = 1, status = 'active', course = ?, branch = ?, department = ?, role = COALESCE(?, role) WHERE id = ? AND collegeName = ?`,
            [course, branch, branch, role || null, userId, collegeName], function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, error: "User not found or already verified." });
                res.json({ success: true, message: "User verified successfully!" });
            });
    });

    // ==========================================
    // ⭐ Public Profile API for view_faculty.html
    // ==========================================
    router.get('/api/faculty/public-profile/:id', requireRole('admin'), (req, res) => {
        const facultyId = req.params.id;
        const collegeName = req.session.user.collegeName;

        // 1. Fetch user info securely scoped to their college
        db.get(`SELECT id, fullName, email, department, branch, program, collegeName, role, status, is_hod 
                FROM account_users WHERE id = ? AND collegeName = ?`, 
        [facultyId, collegeName], (err, user) => {
            
            if (err) return res.status(500).json({ success: false, message: "Database error" });
            if (!user) return res.status(404).json({ success: false, message: "Faculty not found" });

            // 2. Fetch real contribution stats from your actual tables
            const statsQuery = `
                SELECT 
                    (SELECT COUNT(*) FROM contests WHERE createdBy = ?) as totalContests,
                    (SELECT COUNT(*) FROM problems WHERE faculty_id = ?) as totalProblems
            `;

            db.get(statsQuery, [facultyId, facultyId], (err, stats) => {
                res.json({
                    success: true,
                    faculty: user,
                    stats: {
                        problemsCreated: stats ? stats.totalProblems : 0,
                        activeContests: stats ? stats.totalContests : 0
                    }
                });
            });
        });
    });
    // ==========================================
    // VIEW STUDENT ROUTES (Add these near view_faculty)
    // ==========================================
    router.get('/view_student', requireRole('admin'), (req, res) => {
        // Change the path based on where you save the view_student.html file
        res.sendFile(path.join(__dirname, '../views/admin/view_student.html'));
    });
    router.get('/view_student.html', requireRole('admin'), (req, res) => res.redirect('/college/view_student'));


    // ==========================================
    // VIEW STUDENT API (Add this near the faculty public-profile API)
    // ==========================================
    router.get('/api/student/public-profile/:id', requireRole('admin'), (req, res) => {
        const studentId = req.params.id;
        const collegeName = req.session.user.collegeName;

        // Fetch student info securely scoped to their college
        db.get(`SELECT id, fullName, email, department, branch, program, year, section, collegeName, role, status, points, rank, solvedCount 
                FROM account_users WHERE id = ? AND collegeName = ? AND role = 'student'`, 
        [studentId, collegeName], (err, user) => {
            
            if (err) return res.status(500).json({ success: false, message: "Database error" });
            if (!user) return res.status(404).json({ success: false, message: "Student not found" });

            res.json({
                success: true,
                student: user
            });
        });
    });
    // 👇 ADD THIS NEW STUDENT PROFILE API HERE 👇
    router.get('/api/student/public-profile/:id', requireRole('admin'), (req, res) => {
        const studentId = req.params.id;
        const collegeName = req.session.user.collegeName;

        // Fetch student info securely scoped to their college
        db.get(`
            SELECT id, fullName, email, department, branch, program, year, section, collegeName, role, status
            FROM account_users 
            WHERE id = ? AND collegeName = ? AND role = 'student'
        `, [studentId, collegeName], (err, user) => {
            
            if (err) return res.status(500).json({ success: false, message: "Database error" });
            if (!user) return res.status(404).json({ success: false, message: "Student not found" });

            // (Optional) You can add additional queries here to fetch their points/ranks 
            // if you have those tables set up, similar to how you fetch faculty stats.

            res.json({
                success: true,
                student: {
                    ...user,
                    points: 0,       // Default value if not using a points table yet
                    rank: 'Unranked',// Default value
                    solvedCount: 0   // Default value
                }
            });
        });
    });
    // 👆 END NEW STUDENT PROFILE API 👆
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
            // Hash the new password and update BOTH name and password
            bcrypt.hash(password, 10, (err, hash) => {
                if (err) return res.status(500).json({ success: false, message: "Error hashing password" });
                
                db.run(
                    `UPDATE account_users SET fullName = ?, password = ? WHERE id = ?`,
                    [fullName, hash, userId],
                    function(err) {
                        if (err) return res.status(500).json({ success: false, message: "Database error" });
                        req.session.user.fullName = fullName; // Sync session with DB
                        res.json({ success: true, message: "Profile and password updated successfully" });
                    }
                );
            });
        } else {
            // Update ONLY the full name
            db.run(
                `UPDATE account_users SET fullName = ? WHERE id = ?`,
                [fullName, userId],
                function(err) {
                    if (err) return res.status(500).json({ success: false, message: "Database error" });
                    req.session.user.fullName = fullName; // Sync session with DB
                    res.json({ success: true, message: "Profile updated successfully" });
                }
            );
        }
    });

    return router;
}; // End of module.exports
