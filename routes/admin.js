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

    // ==========================================
    // ⭐ DASHBOARD DATA API (GRAPH, FEED, ALERTS)
    // ==========================================
    router.get('/api/dashboard-data', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        
        const graphQuery = `SELECT strftime('%m', createdAt) as month_num, COUNT(*) as count 
                            FROM users WHERE collegeName = ? GROUP BY month_num`;
        
        const feedQuery = `SELECT action, createdAt FROM activity_feed 
                           WHERE collegeName = ? ORDER BY createdAt DESC LIMIT 10`;

        const alertQuery = `SELECT message, type FROM system_alerts ORDER BY createdAt DESC LIMIT 5`;

        db.all(graphQuery, [collegeName], (err, graphRows) => {
            db.all(feedQuery, [collegeName], (err, feedRows) => {
                db.all(alertQuery, [], (err, alertRows) => {
                    res.json({
                        success: true,
                        graph: graphRows || [],
                        activityFeed: feedRows || [],
                        systemAlerts: alertRows || []
                    });
                });
            });
        });
    });

    router.get('/api/activity-stats', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        
        const query = `
            SELECT 
                strftime('%m', createdAt) as month_num,
                COUNT(*) as count
            FROM users 
            WHERE collegeName = ? 
              AND createdAt >= date('now', '-6 months')
            GROUP BY month_num
            ORDER BY createdAt ASC
        `;

        db.all(query, [collegeName], (err, rows) => {
            if (err || !rows || rows.length === 0) {
                // Dynamically return empty if DB is empty instead of hardcoding zeros
                return res.json({ labels: [], data: [] });
            }

            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const labels = rows.map(r => monthNames[parseInt(r.month_num, 10) - 1] || 'Unknown');
            const data = rows.map(r => r.count);

            res.json({ labels, data });
        });
    });

    // ==========================================
    // OTP & PASSWORD APIs
    // ==========================================
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
                html: `<div style="font-family: sans-serif; padding: 20px;">
                        <h2>Email Update Request</h2>
                        <p>Your OTP to verify your new email address is: <strong style="font-size: 24px; color: #1E4A7A;">${otp}</strong></p>
                        <p>This code is valid for 5 minutes.</p>
                    </div>`
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

    router.post('/update-profile', requireRole('admin'), async (req, res) => {
        const { fullName, email, designation, currPass, newPass } = req.body;
        const userId = req.session.user.id;

        try {
            if (newPass && newPass.trim() !== '') {
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

    router.post('/api/approve-faculty/:id', requireRole('admin'), (req, res) => {
        const { course, branch, role } = req.body; 
        const collegeName = req.session.user.collegeName;

        db.get(`SELECT id, role, status, collegeName, pending_college_name, college_request_status FROM users WHERE id = ?`, [req.params.id], (userErr, userRow) => {
            if (userErr) return res.status(500).json({ success: false, error: userErr.message });
            if (!userRow) return res.status(404).json({ success: false, error: 'User not found.' });

            const isStudentCollegeRequest = String(userRow.role || '').toLowerCase() === 'student'
                && String(userRow.college_request_status || '').toLowerCase() === 'pending'
                && String(userRow.pending_college_name || '') === String(collegeName || '');

            if (isStudentCollegeRequest) {
                db.run(`
                    UPDATE users
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
            db.run(`UPDATE users SET status = 'active', is_verified = 1, isVerified = 1, course = ?, branch = ?, department = ?, role = COALESCE(?, role) WHERE id = ? AND collegeName = ?`, 
            [course, branch, branch, assignedRole, req.params.id, collegeName], function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, error: "User not found or not in pending state." });
                res.json({ success: true, message: 'User verified and assigned successfully' });
            });
        });
    });

    router.get('/api/users', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;

        // Simpler, safer query that returns users and computed counts. Complex ranking logic
        // was removed to avoid malformed SQL and heavy nested queries. We can add
        // ranking later in a separate endpoint if needed.
        const query = `
            SELECT u.*,
                (SELECT COUNT(*) FROM contests WHERE createdBy = u.id AND status = 'accepted') AS contests_created,
                (SELECT COUNT(*) FROM problems WHERE faculty_id = u.id AND status = 'accepted') AS problems_created,
                (SELECT COUNT(DISTINCT problem_id) FROM submissions WHERE user_id = u.id AND status = 'accepted') AS problems_solved,
                (SELECT COUNT(DISTINCT contest_id) FROM contest_participants WHERE user_id = u.id) AS contests_participated
            FROM users u
            WHERE u.collegeName = ? AND u.role IN ('student', 'faculty', 'hod', 'hos') AND u.status = 'active'
            ORDER BY u.id DESC
        `;

        db.all(query, [collegeName], (err, rows) => {
            if (err) {
                console.error("Error fetching users:", err && err.message ? err.message : err);
                return res.status(500).json({ success: false, error: err.message || 'Database error' });
            }
            res.json({ success: true, users: rows || [] });
        });
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
            
            await new Promise((resolve, reject) => {
                db.run(`INSERT INTO users (fullName, email, role, password, collegeName, program, branch, department, year, section, status, is_verified, isVerified) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 1)`,
                [
                    user.fullName.trim(), 
                    user.email.toLowerCase().trim(), // Standardize email format
                    user.role, 
                    hashedPassword, 
                    collegeName, 
                    user.program || '', // Fallback to empty string for faculty who might not have these
                    user.branch || '', 
                    user.branch || '',  // Mapping branch to department here
                    user.year || '', 
                    user.section || ''
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
                // We don't push to 'errors' array here because the database insertion was successful,
                // we just failed to send the email (e.g., invalid email format, network issue).
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

                db.run(`INSERT INTO users (role, fullName, email, password, collegeName, branch, department, is_hod, status, program, course, year, section) 
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

        db.get(`SELECT year, semester FROM sections WHERE id = ?`, [section_id], (err, section) => {
            const finalYear = (section && section.year) ? section.year : null; 
            const finalSemester = (section && section.semester) ? section.semester : null;

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

        db.get(`SELECT year, semester FROM sections WHERE id = ?`, [section_id], (err, section) => {
            const finalYear = (section && section.year) ? section.year : null; 
            const finalSemester = (section && section.semester) ? section.semester : null;

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
        const { name, year, semester, capacity } = req.body;
        db.run(`UPDATE sections SET name=?, year=?, semester=?, capacity=? WHERE id=?`, 
            [name, year, semester || null, capacity || null, req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true });
        });
    });

    router.put('/update-subject/:id', requireRole('admin'), (req, res) => {
        const { name, code, credits, section_id } = req.body;
        
        db.get(`SELECT year, semester FROM sections WHERE id = ?`, [section_id], (err, section) => {
            const finalYear = (section && section.year) ? section.year : null;
            const finalSemester = (section && section.semester) ? section.semester : null;

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
    const collegeName = req.session.user.collegeName;
    db.all(`SELECT * FROM contests WHERE collegeName = ? ORDER BY id DESC`, [collegeName], (err, rows) => {
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
        const level = req.params.level; 
        const collegeName = req.session.user.collegeName;
        
        let query = `SELECT * FROM contests WHERE scope = ?`;
        let params = [level];

        if (level === 'college') {
            query += ` AND collegeName = ?`;
            params.push(collegeName);
        }

        db.all(query, params, (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, contests: rows, currentUser: req.session.user.id });
        });
    });

    router.post('/api/contests', requireRole('admin'), (req, res) => {
        const {
            title, scope, level, date, deadline, duration, eligibility, description, discription,
            rulesAndDescription, guidelines, colleges, problem_ids, prize, class: contestClassInput, contest_class,
            startDate, endDate,
            reward, target_programs, allowed_roles 
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

        const targetProgramsStr = target_programs ? JSON.stringify(target_programs) : null;
        const finalAllowedRoles = allowed_roles || null;

        db.run(`INSERT INTO contests (
                    title, scope, level, date, deadline, duration, eligibility, description, rulesAndDescription,
                    guidelines, contest_class, prize, startDate, endDate,
                    status, colleges, createdBy, collegeName, hos_verified, hod_verified,
                    reward, target_programs, allowed_roles
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, 1, 1, ?, ?, ?)`,
            [
                title, finalScope, level, date, deadline, duration, eligibility, finalDescription, finalGuidelines,
                finalGuidelines, normalizedClass, prize || '', finalStartDate, finalEndDate,
                collegesStr, createdBy, collegeName,
                reward || '', targetProgramsStr, finalAllowedRoles
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
        // JOIN with users table to get the creator's college and role for frontend filtering
        const query = `
            SELECT p.*, u.collegeName, u.role as creator_role 
            FROM problems p 
            LEFT JOIN users u ON p.faculty_id = u.id OR p.created_by = u.id
            ORDER BY p.id DESC
        `;
        
        db.all(query, [], (err, rows) => {
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
            startDate, endDate,
            reward, target_programs, allowed_roles 
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
                    guidelines=?, contest_class=?, prize=?, startDate=?, endDate=?, status=?, colleges=?,
                    reward=?, target_programs=?, allowed_roles=?
                WHERE id=?`,
            [
                title, finalScope, level, date, deadline, duration, eligibility, finalDescription, finalGuidelines,
                finalGuidelines, normalizedClass, prize || '', finalStartDate, finalEndDate, status || 'upcoming', collegesStr,
                reward || '', targetProgramsStr, finalAllowedRoles, req.params.id
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
    router.get('/api/faculty/public-profile/:id', requireRole('admin'), (req, res) => {
        const facultyId = req.params.id;
        const collegeName = req.session.user.collegeName;

        db.get(`SELECT id, fullName, email, department, branch, program, collegeName, role, status, is_hod 
                FROM users WHERE id = ? AND collegeName = ?`, 
        [facultyId, collegeName], (err, user) => {
            
            if (err) return res.status(500).json({ success: false, message: "Database error" });
            if (!user) return res.status(404).json({ success: false, message: "Faculty not found" });

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

    router.get('/api/student/public-profile/:id', requireRole('admin'), (req, res) => {
        const studentId = req.params.id;
        const collegeName = req.session.user.collegeName;

        db.get(`
            SELECT id, fullName, email, department, branch, program, year, section, collegeName, role, status
            FROM users 
            WHERE id = ? AND collegeName = ? AND role = 'student'
        `, [studentId, collegeName], (err, user) => {
            
            if (err) return res.status(500).json({ success: false, message: "Database error" });
            if (!user) return res.status(404).json({ success: false, message: "Student not found" });

            res.json({
                success: true,
                student: {
                    ...user,
                    points: user.points || 0,       
                    rank: user.rank || 'Unranked',
                    solvedCount: user.solvedCount || 0   
                }
            });
        });
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
        const query = `UPDATE users SET status = ? WHERE id IN (${placeholders}) AND collegeName = ?`;
        
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
    
    return router;
};