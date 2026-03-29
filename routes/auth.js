const express = require('express');

module.exports = (db, transporter) => {
    const router = express.Router();

    // ==========================================
    // 1. SEND OTP FOR STUDENT/FACULTY SIGNUP
    // ==========================================
    router.post('/send-signup-otp', (req, res) => {
        const { email } = req.body;

        if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

        // Check if the email is already registered
        db.get(`SELECT email FROM users WHERE email = ?`, [email], (err, row) => {
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

                    // Send the email
                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: email,
                        subject: 'Your CampusCode Registration OTP',
                        text: `Your OTP for CampusCode registration is: ${otp}\nThis OTP is valid for 10 minutes.`
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
    router.post('/register-institution', (req, res) => {
        const { role, fullName, collegeName, email, otp, password } = req.body;

        db.get(`SELECT * FROM otps WHERE email = ?`, [email], (err, row) => {
            if (err || !row || Date.now() > row.expiry || row.code !== otp) {
                return res.status(400).send('<h3>Invalid or Expired OTP.</h3><a href="/college-register">Try again</a>');
            }

            // Insert user with 'pending' status instead of 'active'
            db.run(`INSERT INTO users (role, fullName, email, password, collegeName, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
                ['admin', fullName, email, password, collegeName],
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
    });

    // ==========================================
    router.post('/signup', (req, res) => {
        const { name, email, password, collegeName, otp } = req.body;
        const fullName = name; // Map to database field name

        // Verify OTP
        db.get(`SELECT * FROM otps WHERE email = ?`, [email], (err, otpRow) => {
            if (err) return res.status(500).send('<h3>Database error.</h3><a href="/">Go Back</a>');
            if (!otpRow) return res.status(400).send('<h3>OTP not found. Please request a new OTP.</h3><a href="/">Go Back</a>');
            if (Date.now() > otpRow.expiry) return res.status(400).send('<h3>OTP has expired. Please request a new one.</h3><a href="/">Go Back</a>');
            if (otpRow.code !== otp) return res.status(400).send('<h3>Invalid OTP. Please try again.</h3><a href="/">Go Back</a>');

            // ⭐ Phase 1: New accounts are created with role='pending' and is_verified=0
            db.run(
                `INSERT INTO users (fullName, email, password, role, collegeName, status, is_verified, isVerified) VALUES (?, ?, ?, 'pending', ?, 'pending', 0, 0)`,
                [fullName, email, password, collegeName],
                function (err) {
                    if (err) {
                        console.error("Registration Error:", err.message);
                        if (err.message.includes('UNIQUE')) {
                            return res.status(400).send('<h3>Email already registered.</h3><a href="/">Go Back</a>');
                        }
                        return res.status(500).send('<h3>Registration failed. Please try again.</h3><a href="/">Go Back</a>');
                    }
                    db.run(`DELETE FROM otps WHERE email = ?`, [email]);
                    
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
    });

    // ==========================================
    // 4. LOGIN LOGIC
    // ==========================================
    router.post('/login', (req, res) => {
        const { email, password } = req.body;

        db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
            if (err || !user) {
                return res.status(400).send('<h2>Invalid email or password.</h2><a href="/">Go Home</a>');
            }
            if (password !== user.password) {
                return res.status(400).send('<h2>Invalid email or password.</h2><a href="/">Go Home</a>');
            }
            if (user.status === 'pending' || user.status === 'inactive') {
                return res.status(403).send('<h2>Account Pending or Inactive.</h2><p>Please contact your admin.</p><a href="/">Go Home</a>');
            }

            req.session.user = {
                id: user.id,
                role: (user.role === 'hod' || (user.role === 'faculty' && user.is_hod === 1)) ? 'hod' : user.role,
                email: user.email,
                name: user.fullName,
                fullName: user.fullName,
                post: user.post || (user.role === 'faculty' ? (user.is_hod === 1 ? 'HOD' : 'Faculty Member') : user.role),
                college: user.collegeName,
                collegeName: user.collegeName,
                department: user.branch || user.department || '',
                course: user.program || user.course || '',
                joiningDate: user.joiningDate,
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
    // 4. LOG OUT
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

    return router;
};