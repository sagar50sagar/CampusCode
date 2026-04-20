// ==========================================
// 1. ENVIRONMENT & IMPORTS
// ==========================================
require('dotenv').config();

const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const session = require('express-session');
const ejs = require('ejs');
const { requireRole } = require('./middleware/auth');

// Import env-driven database connection (SQLite/PostgreSQL)
const db = require('./db'); 

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 2. MIDDLEWARE & SESSION SETUP
// ==========================================
// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.engine('html', ejs.renderFile);

// Serve static files (CSS, JS, Images) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Parse incoming request bodies (form data and JSON)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Inject global theme script into all rendered HTML pages (non-static stream responses)
app.use((req, res, next) => {
    const originalRender = res.render;
    res.render = function patchedRender(view, locals, callback) {
        let resolvedView = view;
        if (typeof resolvedView === 'string' && resolvedView.startsWith('faculty/') && !resolvedView.endsWith('.html') && !resolvedView.endsWith('.ejs')) {
            resolvedView = `${resolvedView}.html`;
        }
        return originalRender.call(this, resolvedView, locals, callback);
    };

    const originalSend = res.send;
    res.send = function patchedSend(body) {
        try {
            if (typeof body === 'string' && body.includes('</body>') && !body.includes('/js/theme-global.js')) {
                body = body.replace('</body>', '  <script src="/js/theme-global.js"></script>\n</body>');
            }
        } catch (_) {
            // fall through with original body
        }
        return originalSend.call(this, body);
    };
    next();
});

// Session Middleware to track logged-in users securely
app.use(session({
    secret: process.env.SESSION_SECRET || 'campuscode_super_secret_key', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day expiration
}));

// Always serve the public landing page at the root URL.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/public/index.html'));
});

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

// ⭐ Admin Routes (Transporter passed for emails)
const adminRoutes = require('./routes/admin')(db, transporter);

// Assuming you create these standard route files as well:
const facultyRoutes = require('./routes/faculty')(db); 
const studentRoutes = require('./routes/student')(db, transporter);
const hodRoutes = require('./routes/hod')(db, transporter);
const hosRoutes = require('./routes/hos')(db);
const individualRoutes = require('./routes/individual')(db);
const forumRoutes = require('./routes/forum')(db); // Added forum API routes
const problemRoutes = require('./routes/problems')(db); // Problem Solving System
const supportRoutes = require('./routes/support')(db);

// Mount the routers to specific URL paths (Namespacing)
app.use('/', publicRoutes);                  // Handles public pages like Home
app.use('/auth', authRoutes);                // Handles Login, Signup, OTPs, Logout
app.use('/superadmin', superadminRoutes);    // Protected Superadmin routes
app.use('/college', adminRoutes);            // Protected College Admin routes
app.use('/college', hodRoutes);              // Protected HOD routes
app.use('/', hosRoutes);                     // Protected HOS routes
app.use('/faculty', facultyRoutes);          // Protected Faculty routes
app.use('/student', studentRoutes);          // Protected Student routes
app.use('/individual', individualRoutes);    // Protected Individual routes
app.use('/api/forum', forumRoutes);          // JSON API for Forum
app.use('/api/problems', problemRoutes);      // JSON API for Problems
app.use('/', problemRoutes);                  // Page routes for student/superadmin problem pages
app.use('/api/support', supportRoutes);       // Shared help/support ticket API

// Backward-compatible aliases for SuperAdmin contest actions
app.get('/api/contests', requireRole('superadmin'), (req, res) => res.redirect(307, '/superadmin/api/contests'));
app.post('/api/contests', requireRole('superadmin'), (req, res) => res.redirect(307, '/superadmin/api/contests'));
app.delete('/api/contests/:id', requireRole('superadmin'), (req, res) => res.redirect(307, `/superadmin/api/contests/${req.params.id}`));
app.post('/api/contests/:id/publish', requireRole('superadmin'), (req, res) => res.redirect(307, `/superadmin/api/contests/${req.params.id}/publish`));
app.post('/api/contests/:id/problems', requireRole('superadmin'), (req, res) => res.redirect(307, `/superadmin/api/contests/${req.params.id}/problems`));

// Backward-compatible alias for legacy forum thread links without .html
app.get('/forum/thread', (req, res) => {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(`/forum/thread.html${query}`);
});

// Backward-compatible alias for legacy admin HOD toggle calls without /college prefix
app.put('/api/faculty/:id/hod', requireRole('admin'), (req, res) =>
    res.redirect(307, `/college/api/faculty/${req.params.id}/hod`)
);

// Backward-compatible aliases for legacy HOD subject de-assignment calls
app.post('/api/deassign-subject', requireRole('hod'), (req, res) =>
    res.redirect(307, '/college/hod/api/deassign-subject')
);
app.post('/hod/api/deassign-subject', requireRole('hod'), (req, res) =>
    res.redirect(307, '/college/hod/api/deassign-subject')
);

// Backward-compatible aliases for legacy HOD role assignment calls
app.post('/api/assign-role', requireRole('hod'), (req, res) =>
    res.redirect(307, '/college/hod/api/assign-role')
);
app.post('/hod/api/assign-role', requireRole('hod'), (req, res) =>
    res.redirect(307, '/college/hod/api/assign-role')
);
app.post('/college/api/assign-role', requireRole('hod'), (req, res) =>
    res.redirect(307, '/college/hod/api/assign-role')
);

// Silence favicon 404 noise in browser console when no favicon asset is provided.
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ==========================================
// 5. START SERVER
// ==========================================
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`👉 SuperAdmin Login: super@campuscode.com / super123`);
    console.log(`📁 Make sure your new folder structure (routes/, views/) is in place!`);
});

// Keep diagnostics visible if the process tries to exit unexpectedly.
process.on('beforeExit', (code) => {
    console.error(`[WARN] Process is about to exit with code ${code}.`);
});

server.on('close', () => {
    console.error('[WARN] HTTP server was closed.');
});

// In interactive terminals, this prevents accidental early process exit.
if (process.stdin && process.stdin.isTTY) {
    process.stdin.resume();
}
