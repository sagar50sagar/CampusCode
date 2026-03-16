// ==========================================
// 1. ENVIRONMENT & IMPORTS
// ==========================================
require('dotenv').config();

const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const session = require('express-session');

// Import the modularized database connection
const db = require('./database'); 

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 2. MIDDLEWARE & SESSION SETUP
// ==========================================
// Serve static files (CSS, JS, Images) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Parse incoming request bodies (form data and JSON)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session Middleware to track logged-in users securely
app.use(session({
    secret: process.env.SESSION_SECRET || 'campuscode_super_secret_key', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day expiration
}));

// ==========================================
// 3. EMAIL CONFIGURATION (Nodemailer)
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS  
    }
});

// ==========================================
// 4. IMPORT & MOUNT ROUTERS
// ==========================================
// Import the separated route files, passing the db and transporter where needed
const publicRoutes = require('./routes/index')(db);
const authRoutes = require('./routes/auth')(db, transporter);
const superadminRoutes = require('./routes/superadmin')(db);
const adminRoutes = require('./routes/admin')(db);
// Assuming you create these standard route files as well:
const facultyRoutes = require('./routes/faculty')(db); 
const studentRoutes = require('./routes/student')(db);

// Mount the routers to specific URL paths (Namespacing)
app.use('/', publicRoutes);                  // Handles public pages like Home
app.use('/auth', authRoutes);                // Handles Login, Signup, OTPs, Logout
app.use('/superadmin', superadminRoutes);    // Protected Superadmin routes
app.use('/college', adminRoutes);            // Protected College Admin routes
app.use('/faculty', facultyRoutes);          // Protected Faculty routes
app.use('/student', studentRoutes);          // Protected Student routes

// ==========================================
// 5. START SERVER
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`👉 SuperAdmin Login: super@campuscode.com / super123`);
    console.log(`📁 Make sure your new folder structure (routes/, views/) is in place!`);
});