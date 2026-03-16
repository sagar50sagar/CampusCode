/**
 * Role-Based Access Control Middleware
 * * Usage in routes:
 * const { requireRole } = require('../middleware/auth');
 * router.get('/dashboard', requireRole('admin'), (req, res) => { ... });
 */

function requireRole(role) {
    return (req, res, next) => {
        // Check if the request is an API call (to return JSON instead of HTML redirects)
        const isApiRoute = req.originalUrl.includes('/api/');

        // 1. Check if the user is logged in
        if (!req.session || !req.session.user) {
            if (isApiRoute) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Unauthorized: Please log in to continue.' 
                });
            }
            // If it's a page request, redirect them to the home/login page
            return res.redirect('/'); 
        }

        // 2. Check if the user has the required role
        if (req.session.user.role !== role) {
            if (isApiRoute) {
                return res.status(403).json({ 
                    success: false, 
                    error: 'Forbidden: You do not have permission to perform this action.' 
                });
            }
            // If it's a page request, show an access denied message
            return res.status(403).send(`
                <div style="text-align: center; margin-top: 100px; font-family: sans-serif;">
                    <h2 style="color: #e11d48;">Access Denied 🛑</h2>
                    <p>You do not have the required permissions to view this page.</p>
                    <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #1E4A7A; color: white; text-decoration: none; border-radius: 5px;">Return Home</a>
                </div>
            `);
        }

        // 3. User is authenticated and authorized, proceed to the route controller
        next();
    };
}

module.exports = { requireRole };