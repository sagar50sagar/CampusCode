const express = require('express');
const bcrypt = require('bcrypt'); // ⭐ Added for secure password handling

module.exports = (db, transporter) => {
    const router = express.Router();

    const USER_LOOKUP_SQL = `
        SELECT *, 'student' as source_table FROM student WHERE email = ?
        UNION ALL
        SELECT *, 'faculty' as source_table FROM faculty WHERE email = ?
        LIMIT 1
    `;

    // ==========================================
    // 1. SEND OTP FOR STUDENT/FACULTY SIGNUP
    // ==========================================
    router.post('/send-signup-otp', (req, res) => {
        const { email } = req.body;

        if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

        // Check if the email is already registered
        db.get(USER_LOOKUP_SQL, [email, email], (err, row) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error.' });
            if (row) return res.status(400).json({ success: false, message: 'Email is already registered.' });

            // Generate a 6-digit OTP
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

            db.run(`INSERT INTO otps (email, code, expiry) VALUES (?, ?, ?) 
                    ON CONFLICT(email) DO UPDATE SET code=excluded.code, expiry=excluded.expiry`,
                [email, otp, expiry],
                (err) => {
                    if (err) return res.status(500).json({ success: false, message: 'Database error saving OTP.' });

                    // Send the email with a beautiful responsive HTML template
                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: email,
                        subject: 'Verify Your Email - CampusCode',
                        html: `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="utf-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>CampusCode OTP</title>
                        </head>
                        <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; -webkit-font-smoothing: antialiased;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 40px 20px;">
                                <tr>
                                    <td align="center">
                                        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.05);">
                                            
                                            <tr>
                                                <td align="center" style="background: linear-gradient(135deg, #1E4A7A 0%, #2E5E99 100%); padding: 35px 20px;">
                                                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 1px;">CampusCode</h1>
                                                </td>
                                            </tr>

                                            <tr>
                                                <td align="center" style="padding: 40px 30px;">
                                                    <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin-top: 0; margin-bottom: 15px;">Verify Your Email</h2>
                                                    <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-top: 0; margin-bottom: 30px; max-width: 450px;">
                                                        Welcome to CampusCode! Please use the verification code below to complete your registration. This code is valid for the next <strong>10 minutes</strong>.
                                                    </p>
                                                    
                                                    <table border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                                                        <tr>
                                                            <td align="center" style="background-color: #E7F0FA; border: 2px dashed #7BA4D0; border-radius: 12px; padding: 20px 40px;">
                                                                <span style="font-family: monospace; font-size: 38px; font-weight: bold; color: #1E4A7A; letter-spacing: 8px;">${otp}</span>
                                                            </td>
                                                        </tr>
                                                    </table>

                                                    <p style="color: #6b7280; font-size: 14px; margin-top: 35px; margin-bottom: 0; line-height: 1.5;">
                                                        If you did not request this code, please safely ignore this email.
                                                    </p>
                                                </td>
                                            </tr>

                                            <tr>
                                                <td align="center" style="background-color: #f9fafb; border-top: 1px solid #e5e7eb; padding: 20px;">
                                                    <p style="color: #9ca3af; font-size: 12px; margin: 0; line-height: 1.5;">
                                                        &copy; ${new Date().getFullYear()} CampusCode. All rights reserved.<br>
                                                        Transforming Campus Coding
                                                    </p>
                                                </td>
                                            </tr>

                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </body>
                        </html>
                        `
                    };

                    transporter.sendMail(mailOptions, (error, info) => {
                        if (error) {
                            console.error("Email Error:", error);
                            return res.status(500).json({ success: false, message: 'Failed to send OTP.' });
                        }
                        res.json({ success: true, message: 'OTP sent successfully.' });
                    });
                }
            );
        });
    });

    // ==========================================
    // 2. INSTITUTION REGISTRATION (OTP Verification)
    // ==========================================
    router.post('/register-institution', async (req, res) => {
        const { role, fullName, collegeName, email, otp, password } = req.body;

        try {
            // ⭐ Hash the password before saving
            const hashedPassword = await bcrypt.hash(password, 10);

            db.get(`SELECT * FROM otps WHERE email = ?`, [email], (err, row) => {
                if (err || !row || Date.now() > row.expiry || row.code !== otp) {
                    return res.status(400).send('<h3>Invalid or Expired OTP.</h3><a href="/college-register">Try again</a>');
                }

                // Insert user with 'pending' status instead of 'active'
                db.run(`INSERT INTO faculty (role, fullName, email, password, collegeName, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
                    ['admin', fullName, email, hashedPassword, collegeName], // ⭐ using hashedPassword here
                    function (err) {
                        if (err) return res.status(500).send('Registration failed. Email might already exist.');

                        db.run(`DELETE FROM otps WHERE email = ?`, [email]);

                        // Show a success message indicating approval is required
                        res.send(`
                            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                                <h2 style="color: #1E4A7A;">Verification Successful!</h2>
                                <p>Your college registration has been submitted and is currently <strong>pending Superadmin approval</strong>.</p>
                                <p>You will be able to log in once your account is activated.</p>
                                <br>
                                <a href="/" style="padding: 10px 20px; background: #1E4A7A; color: white; text-decoration: none; border-radius: 5px;">Return to Home</a>
                            </div>
                        `);
                    }
                );
            });
        } catch (error) {
            console.error(error);
            return res.status(500).send('<h3>Server error during registration.</h3><a href="/college-register">Go Back</a>');
        }
    });

    // ==========================================
    // 3. STUDENT/FACULTY SIGNUP
    // ==========================================
    router.post('/signup', async (req, res) => {
        const { name, email, password, collegeName, role, otp } = req.body;
        const fullName = name; // Map to database field name
        const userRole = role ? role.trim().toLowerCase() : 'student';

        try {
            // ⭐ Hash the password before saving
            const hashedPassword = await bcrypt.hash(password, 10);

            // Verify OTP
            db.get(`SELECT * FROM otps WHERE email = ?`, [email], (err, otpRow) => {
                if (err) return res.status(500).send('<h3>Database error.</h3><a href="/">Go Back</a>');
                if (!otpRow) return res.status(400).send('<h3>OTP not found. Please request a new OTP.</h3><a href="/">Go Back</a>');
                if (Date.now() > otpRow.expiry) return res.status(400).send('<h3>OTP has expired. Please request a new one.</h3><a href="/">Go Back</a>');
                if (otpRow.code !== otp) return res.status(400).send('<h3>Invalid OTP. Please try again.</h3><a href="/">Go Back</a>');

                const college = collegeName ? collegeName.trim() : '';
                const isIndependentStudent = userRole === 'student' && !college;
                const status = isIndependentStudent ? 'active' : 'pending';
                const verified = isIndependentStudent ? 1 : 0;

                const targetTable = userRole === 'student' || userRole === 'superadmin' ? 'student' : 'faculty';
                db.run(
                    `INSERT INTO ${targetTable} (fullName, email, password, role, collegeName, status, is_verified, isVerified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [fullName, email, hashedPassword, userRole, college, status, verified, verified],
                    function (err) {
                        if (err) {
                            console.error("Registration Error:", err.message);
                            if (err.message.includes('UNIQUE')) {
                                return res.status(400).send('<h3>Email already registered.</h3><a href="/">Go Back</a>');
                            }
                            return res.status(500).send('<h3>Registration failed. Please try again.</h3><a href="/">Go Back</a>');
                        }
                        db.run(`DELETE FROM otps WHERE email = ?`, [email]);
                        
                        if (isIndependentStudent) {
                            return res.send(`
                                <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                                    <h2 style="color: #1E4A7A;">Registration Successful!</h2>
                                    <p>Your account has been created successfully.</p>
                                    <p>You can now <a href="/" style="color: #2563eb; font-weight: 600;">sign in</a>.</p>
                                </div>
                            `);
                        }

                        return res.send(`
                            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                                <h2 style="color: #1E4A7A;">Registration Successful!</h2>
                                <p>Your account request has been submitted and is currently <strong>pending approval by your College Admin</strong>.</p>
                                <p>You will be able to log in once your account is verified and assigned a role.</p>
                                <br>
                                <a href="/" style="padding: 10px 20px; background: #1E4A7A; color: white; text-decoration: none; border-radius: 5px;">Return to Home</a>
                            </div>
                        `);
                    }
                );
            });
        } catch (error) {
            console.error(error);
            return res.status(500).send('<h3>Server error during signup.</h3><a href="/">Go Back</a>');
        }
    });

    // ==========================================
    // 4. LOGIN LOGIC
    // ==========================================
    router.post('/login', (req, res) => {
        const { email, password } = req.body;

        db.get(USER_LOOKUP_SQL, [email, email], async (err, user) => {
            if (err || !user) {
                return res.status(400).send('<h2>Invalid email or password.</h2><a href="/">Go Home</a>');
            }

            // ⭐ Check if password matches (Handles both bcrypt and old plain-text passwords)
            let isMatch = false;
            
            // bcrypted passwords usually start with $2a$ or $2b$
            if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
                isMatch = await bcrypt.compare(password, user.password);
            } else {
                // Fallback for plain-text accounts (like the default SuperAdmin 'super123')
                isMatch = (password === user.password);
            }

            if (!isMatch) {
                return res.status(400).send('<h2>Invalid email or password.</h2><a href="/">Go Home</a>');
            }

            if (user.status === 'pending' || user.status === 'inactive') {
                return res.status(403).send('<h2>Account Pending or Inactive.</h2><p>Please contact your admin.</p><a href="/">Go Home</a>');
            }

            const roleFromDb = String(user.role || '').toLowerCase();
            const postFromDb = String(user.post || '').toLowerCase();
            const effectiveRole = (roleFromDb === 'hod' || (roleFromDb === 'faculty' && user.is_hod === 1))
                ? 'hod'
                : (roleFromDb === 'faculty' && postFromDb.includes('hos') ? 'hos' : roleFromDb);

            if (effectiveRole === 'hos' && roleFromDb !== 'hos') {
                // Auto-heal legacy mismatch where user is marked as HOS in post but role stayed faculty
                const target = user.source_table === 'faculty' ? 'faculty' : 'student';
                db.run(`UPDATE ${target} SET role = 'hos' WHERE id = ?`, [user.id], () => {});
            }

            req.session.user = {
                id: user.id,
                role: effectiveRole,
                email: user.email,
                name: user.fullName,
                fullName: user.fullName,
                post: user.post || (user.role === 'faculty' ? (user.is_hod === 1 ? 'HOD' : 'Faculty Member') : user.role),
                college: user.collegeName,
                collegeName: user.collegeName,
                department: user.branch || user.department || '',
                course: user.program || user.course || '',
                isVerified: user.isVerified === 1 || user.isVerified === true
            };

            // Redirect based on role
            const userRole = req.session.user.role ? req.session.user.role.toLowerCase() : '';
            if (userRole === 'superadmin') res.redirect('/superadmin/dashboard');
            else if (userRole === 'admin') res.redirect('/college/dashboard');
            else if (userRole === 'hod') res.redirect('/college/hod/dashboard');
            else if (userRole === 'hos') res.redirect('/hos/dashboard');
            else if (userRole === 'faculty') res.redirect('/faculty/dashboard');
            else if (userRole === 'student') res.redirect('/student/dashboard');
            else res.redirect('/');
        });
    });

    // ==========================================
    // 5. LOG OUT
    // ==========================================
    router.get('/logout', (req, res) => {
        req.session.destroy();
        res.redirect('/');
    });

    router.post('/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ success: false, message: 'Logout failed' });
            res.clearCookie('connect.sid'); 
            res.json({ success: true, message: 'Logged out successfully' });
        });
    });

    // ==========================================
    // ==========================================
    // ⭐ FACULTY PUBLIC PROFILE API
    // ==========================================
    router.get('/api/faculty/public-profile/:id', (req, res) => {
        const facultyId = req.params.id;

        // Fetch user info (Only public fields)
        db.get(`SELECT id, fullName, email, department, branch, program, collegeName, role, status, is_hod FROM faculty WHERE id = ?`, [facultyId], (err, user) => {
            if (err) return res.status(500).json({ success: false, message: "Database error" });
            if (!user) return res.status(404).json({ success: false, message: "Faculty not found" });

            res.json({
                success: true,
                faculty: user,
                stats: {
                    problemsCreated: 0, 
                    activeContests: 0    
                }
            });
        });
    });

    // ⭐ IMPORTANT: This MUST be the absolute last thing inside module.exports!
    return router;
};