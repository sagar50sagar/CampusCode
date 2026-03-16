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

            db.run(`INSERT INTO users (role, fullName, email, password, collegeName, status) VALUES (?, ?, ?, ?, ?, 'active')`,
                ['admin', fullName, email, password, collegeName],
                function(err) {
                    if (err) return res.status(500).send('Registration failed. Email might already exist.');
                    
                    db.run(`DELETE FROM otps WHERE email = ?`, [email]);
                    
                    // Automatically log the admin in
                    req.session.user = { id: this.lastID, role: 'admin', email: email, name: fullName, collegeName: collegeName };
                    res.redirect('/college/dashboard'); // Pointing to the new namespace
                }
            );
        });
    });

    // ==========================================
    // 3. LOGIN LOGIC
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
                role: user.role, 
                email: user.email, 
                name: user.fullName,
                collegeName: user.collegeName 
            };

            // Redirect based on role
            if (user.role === 'superadmin') res.redirect('/superadmin/dashboard');
            else if (user.role === 'admin') res.redirect('/college/dashboard');
            else if (user.role === 'faculty') res.redirect('/faculty/dashboard');
            else if (user.role === 'student') res.redirect('/student/dashboard');
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

    return router;
};