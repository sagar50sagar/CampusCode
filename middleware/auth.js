/**
 * Role-Based Access Control Middleware
 * * Usage in routes:
 * const { requireRole } = require('../middleware/auth');
 * router.get('/dashboard', requireRole('admin'), (req, res) => { ... });
 */

function requireRole(roles) {
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    // Define role hierarchy
    const hierarchy = {
        'superadmin': ['superadmin', 'admin', 'hod', 'hos', 'faculty', 'student'],
        'admin': ['admin', 'hod', 'hos', 'faculty', 'student'],
        'hod': ['hod', 'hos', 'faculty', 'student'],
        'hos': ['hos', 'faculty'],
        'faculty': ['faculty'],
        'individual': ['individual', 'student'],
        'student': ['student']
    };

    return (req, res, next) => {
        const isApiRoute = req.originalUrl.includes('/api/') || 
                          (req.headers.accept && req.headers.accept.includes('application/json')) ||
                          (req.headers['content-type'] && req.headers['content-type'].includes('application/json'));

        if (!req.session || !req.session.user) {
            if (isApiRoute) {
                return res.status(401).json({ success: false, error: 'Unauthorized: Please log in to continue.' });
            }
            return res.redirect('/'); 
        }

        const userRole = req.session.user.role ? req.session.user.role.toLowerCase() : '';
        const accessibleRoles = hierarchy[userRole] || [userRole];

        // Check if user has any of the allowed roles OR if their hierarchical access covers any allowed role
        const hasAccess = allowedRoles.some(role => accessibleRoles.includes(role));

        if (!hasAccess) {
            if (isApiRoute) {
                return res.status(403).json({ 
                    success: false, 
                    error: `Forbidden: Access restricted to ${allowedRoles.join(', ')}.` 
                });
            }
            return res.status(403).send(`
                <div style="text-align: center; margin-top: 100px; font-family: sans-serif;">
                    <h2 style="color: #e11d48;">Access Denied 🛑</h2>
                    <p>You do not have the required permissions to view this page. Restricted to: <b>${allowedRoles.join(', ')}</b></p>
                    <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #1E4A7A; color: white; text-decoration: none; border-radius: 5px;">Return Home</a>
                </div>
            `);
        }

        next();
    };
}

module.exports = { requireRole };
