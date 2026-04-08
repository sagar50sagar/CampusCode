// ==========================================
// FORUM CLIENT LOGIC
// ==========================================

let currentUser = null;
let currentNavConfig = null;

document.addEventListener('DOMContentLoaded', async () => {
    initializeTheme();

    // 1. Fetch user context universally across pages
    await fetchUserContext();

    // 2. Identify the current page loosely based on path
    const path = window.location.pathname;

    if (path.includes('forum.html') || path.endsWith('/forum/')) {
        initForumListing();
    } else if (path.includes('create.html')) {
        initCreateThread();
    } else if (path.includes('thread.html')) {
        initThreadDetail();
    }
});

// ==========================================
// CORE AUTH
// ==========================================
async function fetchUserContext() {
    try {
        const res = await fetch('/api/forum/me');
        const data = await res.json();
        
        if (data.success && data.user) {
            currentUser = data.user;
            currentNavConfig = getNavConfig(currentUser.role);
            applyUserShell();
        } else {
            // Not logged in -> Redirect home/login
            window.location.href = '/';
        }
    } catch (error) {
        console.error("Error fetching user session:", error);
    }
}

function initializeTheme() {
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }

    const themeToggle = document.getElementById('themeToggle') || document.getElementById('themeToggleBtn');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    syncThemeIcon();

    const sidebarBrandBtn = document.getElementById('sidebarBrandBtn');
    if (sidebarBrandBtn && !sidebarBrandBtn.dataset.bound) {
        sidebarBrandBtn.dataset.bound = 'true';
        sidebarBrandBtn.addEventListener('click', toggleSidebar);
    }
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    syncThemeIcon();
}

function syncThemeIcon() {
    const icon = document.getElementById('themeIcon') || document.querySelector('#themeToggleBtn i');
    if (icon) {
        icon.className = document.documentElement.classList.contains('dark') ? 'fas fa-sun' : 'fas fa-moon';
    }
}

function getNavConfig(roleValue) {
    const role = (roleValue || '').toLowerCase();
    const commonForum = { href: '/forum/forum.html', icon: 'fas fa-comments', label: 'Community', key: 'community' };

    const configMap = {
        student: {
            dashboard: '/student/dashboard',
            label: 'Student',
            items: [
                { href: '/student/dashboard', icon: 'fas fa-home', label: 'Home', key: 'dashboard' },
                { href: '/student/problems', icon: 'fas fa-tasks', label: 'Problems', key: 'problems' },
                { href: '/student/contests', icon: 'fas fa-trophy', label: 'Contests', key: 'contests' },
                commonForum,
                { href: '/student/stats', icon: 'fas fa-list', label: 'Stats', key: 'stats' },
                { href: '/student/report', icon: 'fas fa-chart-pie', label: 'Report', key: 'report' },
                { href: '/student/profile', icon: 'fas fa-user', label: 'Profile', key: 'profile' }
            ]
        },
        faculty: {
            dashboard: '/faculty/dashboard',
            label: 'Faculty',
            items: [
                { href: '/faculty/dashboard', icon: 'fas fa-home', label: 'Dashboard', key: 'dashboard' },
                { href: '/faculty/problem', icon: 'fas fa-tasks', label: 'Problems', key: 'problem' },
                { href: '/faculty/contest', icon: 'fas fa-trophy', label: 'Contests', key: 'contest' },
                commonForum,
                { href: '/faculty/report', icon: 'fas fa-chart-pie', label: 'Reports', key: 'report' }
            ]
        },
        hod: {
            dashboard: '/college/hod/dashboard',
            label: 'HOD',
            items: [
                { href: '/college/hod/dashboard', icon: 'fas fa-home', label: 'Dashboard', key: 'dashboard' },
                { href: '/college/hod/problem', icon: 'fas fa-tasks', label: 'Problems', key: 'problem' },
                { href: '/college/hod/contest', icon: 'fas fa-trophy', label: 'Contests', key: 'contest' },
                { href: '/college/hod/faculty', icon: 'fas fa-users', label: 'Faculty', key: 'faculty' },
                { href: '/college/hod/student', icon: 'fas fa-user-graduate', label: 'Students', key: 'student' },
                commonForum,
                { href: '/college/hod/report', icon: 'fas fa-chart-pie', label: 'Reports', key: 'report' }
            ]
        },
        hos: {
            dashboard: '/hos/dashboard',
            label: 'HOS',
            items: [
                { href: '/hos/dashboard', icon: 'fas fa-home', label: 'Dashboard', key: 'dashboard' },
                { href: '/hos/problem', icon: 'fas fa-tasks', label: 'Problems', key: 'problem' },
                { href: '/hos/contest', icon: 'fas fa-trophy', label: 'Contests', key: 'contest' },
                { href: '/hos/faculty', icon: 'fas fa-users', label: 'Faculty', key: 'faculty' },
                { href: '/hos/student', icon: 'fas fa-user-graduate', label: 'Students', key: 'student' },
                commonForum,
                { href: '/hos/report', icon: 'fas fa-chart-pie', label: 'Reports', key: 'report' }
            ]
        },
        admin: {
            dashboard: '/college/dashboard',
            label: 'Admin',
            items: [
                { href: '/college/dashboard', icon: 'fas fa-home', label: 'Dashboard', key: 'dashboard' },
                { href: '/college/contest', icon: 'fas fa-trophy', label: 'Contests', key: 'contest' },
                { href: '/college/report', icon: 'fas fa-chart-pie', label: 'Reports', key: 'report' },
                commonForum
            ]
        },
        superadmin: {
            dashboard: '/superadmin/dashboard',
            label: 'SuperAdmin',
            items: [
                { href: '/superadmin/dashboard', icon: 'fas fa-building-columns', label: 'Manage Colleges', key: 'dashboard' },
                { href: '/superadmin/problems', icon: 'fas fa-tasks', label: 'Manage Problems', key: 'problems' },
                { href: '/superadmin/contest', icon: 'fas fa-trophy', label: 'Manage Contests', key: 'contest' },
                { href: '/forum/forum.html', icon: 'fas fa-comments', label: 'Community Forum', key: 'community' }
            ]
        }
    };

    return configMap[role] || {
        dashboard: '/',
        label: roleValue || 'User',
        items: [commonForum]
    };
}

function applyUserShell() {
    const fullName = currentUser.fullName || 'User';
    const normalizedRole = String(currentUser.role || '').toLowerCase();
    const initials = fullName.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';
    const prettyRole = currentNavConfig?.label || currentUser.role || 'User';

    setText('userNameHeader', fullName);
    setText('userRoleHeader', prettyRole);
    setText('sidebarName', fullName);
    setText('sidebarRole', prettyRole);
    setText('profileName', fullName);
    setText('profileMeta', `${prettyRole}${currentUser.collegeName ? ` · ${currentUser.collegeName}` : ''}`);

    ['sidebarAvatar', 'headerAvatar', 'profileAvatarLarge'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = initials;
    });

    const heroBackLink = document.getElementById('heroBackLink');
    if (heroBackLink && currentNavConfig) {
        heroBackLink.href = currentNavConfig.dashboard;
    }

    const dashboardLink = document.getElementById('profileDashboardLink');
    if (dashboardLink && currentNavConfig) {
        dashboardLink.href = currentNavConfig.dashboard;
    }

    const profileLink = document.getElementById('profileProfileLink');
    if (profileLink) {
        if (normalizedRole === 'student') {
            profileLink.href = '/student/profile';
        } else {
            profileLink.classList.add('hidden');
        }
    }

    const supportLink = document.getElementById('sidebarSupportLink');
    const supportLabel = document.getElementById('sidebarSupportLabel');
    if (supportLink && supportLabel && normalizedRole === 'superadmin') {
        supportLink.href = '/auth/logout';
        supportLabel.textContent = 'Logout';
        supportLink.querySelector('i')?.classList.replace('fa-question-circle', 'fa-sign-out-alt');
    }

    document.body.classList.toggle('superadmin-shell', normalizedRole === 'superadmin');

    renderRoleSidebar();
    bindProfileOverlay();
}

function renderRoleSidebar() {
    const nav = document.getElementById('roleSidebarNav');
    if (!nav || !currentNavConfig) return;

    const currentPath = window.location.pathname;
    nav.innerHTML = currentNavConfig.items.map(item => {
        const isCommunity = item.key === 'community';
        const isActive = isCommunity ? currentPath.includes('/forum/') : currentPath === item.href;
        const baseClass = isActive ? 'nav-item active' : 'nav-item';
        return `
            <a href="${item.href}" class="${baseClass}">
                <i class="${item.icon}"></i>
                <span>${item.label}</span>
            </a>
        `;
    }).join('');
}

function toggleSidebar() {
    const sidebar = document.getElementById('mainSidebar');
    const sidebarLogoText = document.getElementById('sidebarLogoText');
    const headerLogoText = document.getElementById('headerLogoText');

    if (!sidebar) return;

    sidebar.classList.toggle('collapsed');
    if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.replace('w-64', 'w-20');
        if (sidebarLogoText) {
            sidebarLogoText.style.opacity = '0';
            sidebarLogoText.style.width = '0px';
        }
        if (headerLogoText) {
            headerLogoText.classList.remove('hidden');
            setTimeout(() => headerLogoText.classList.remove('opacity-0', '-translate-x-2'), 50);
        }
    } else {
        sidebar.classList.replace('w-20', 'w-64');
        if (sidebarLogoText) {
            sidebarLogoText.style.opacity = '1';
            sidebarLogoText.style.width = 'auto';
        }
        if (headerLogoText) {
            headerLogoText.classList.add('opacity-0', '-translate-x-2');
            setTimeout(() => headerLogoText.classList.add('hidden'), 300);
        }
    }
}

function bindProfileOverlay() {
    const overlay = document.getElementById('profileOverlay');
    const card = document.getElementById('profileCard');
    const openers = [document.getElementById('headerProfileBtn'), document.getElementById('sidebarProfileBtn')].filter(Boolean);
    const closeBtn = document.getElementById('closeProfileOverlay');

    if (!overlay || !card || openers.length === 0 || overlay.dataset.bound === 'true') return;
    overlay.dataset.bound = 'true';

    const openOverlay = () => {
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
            card.classList.remove('scale-95');
        });
    };

    const closeOverlay = () => {
        overlay.classList.add('opacity-0');
        card.classList.add('scale-95');
        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
        }, 200);
    };

    openers.forEach(btn => btn.addEventListener('click', openOverlay));
    if (closeBtn) closeBtn.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeOverlay();
    });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// ==========================================
// PAGE: FORUM LISTING
// ==========================================
function initForumListing() {
    let currentFilter = 'global';
    let currentSort = 'latest';
    let currentSearch = '';
    let currentTopic = 'all';

    const searchInput = document.getElementById('searchInput');
    const filterGlobal = document.getElementById('filterGlobal');
    const filterCollege = document.getElementById('filterCollege');
    const sortSelect = document.getElementById('sortSelect');
    const topics = document.querySelectorAll('.topic-card');

    // Debounce Search
    let timeout = null;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            currentSearch = e.target.value.trim();
            loadThreads();
        }, 300);
    });

    // Filter Buttons
    filterGlobal.addEventListener('click', () => {
        currentFilter = 'global';
        filterGlobal.classList.add('active');
        filterCollege.classList.remove('active');
        loadThreads();
    });

    filterCollege.addEventListener('click', () => {
        currentFilter = 'college';
        filterCollege.classList.add('active');
        filterGlobal.classList.remove('active');
        loadThreads();
    });

    // Sort Dropdown
    sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        loadThreads();
    });

    // Topics Filter (Frontend filtering for simplicity, or we can send it via API. Let's do frontend filtering from fetched data)
    topics.forEach(card => {
        card.addEventListener('click', () => {
            topics.forEach(t => t.classList.remove('selected'));
            card.classList.add('selected');
            currentTopic = card.dataset.topic; // 'all', 'web', 'backend', etc.
            loadThreads();
        });
    });

    // Load Threads Data
    async function loadThreads() {
        const container = document.getElementById('threadsContainer');
        const loader = document.getElementById('loading');
        
        container.innerHTML = '';
        loader.style.display = 'block';

        try {
            const res = await fetch(`/api/forum/threads?filter=${currentFilter}&sort=${currentSort}&search=${encodeURIComponent(currentSearch)}`);
            const data = await res.json();
            
            loader.style.display = 'none';

            if (!data.success) {
                container.innerHTML = `<div class="text-red-500 py-4">Error loading threads.</div>`;
                return;
            }

            let threads = data.threads;
            
            // Filter locally by topic if not 'all'
            if(currentTopic !== 'all') {
                threads = threads.filter(t => t.topic === currentTopic);
            }

            if (threads.length === 0) {
                container.innerHTML = `<div class="text-gray-500 py-10 text-center bg-white dark:bg-gray-800 rounded-lg">No discussions found matching criteria.</div>`;
                return;
            }

            threads.forEach(t => {
                const badgeColor = getBadgeColor(t.topic);
                
                let deleteButtonHTML = '';
                if(currentUser && currentUser.role === 'superadmin') {
                    deleteButtonHTML = `<button onclick="deleteThread(${t.id}, event)" class="absolute top-4 right-4 text-red-500 hover:bg-red-50 p-2 rounded-lg text-sm"><i class="fas fa-trash"></i> Delete</button>`;
                }

                container.innerHTML += `
                    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-all cursor-pointer p-6 relative" 
                         onclick="window.location.href='/forum/thread.html?id=${t.id}'">
                        ${deleteButtonHTML}
                        <div class="flex items-center space-x-3 mb-2">
                            <span class="px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeColor}">${t.topic.toUpperCase()}</span>
                            <span class="text-sm text-gray-500"><i class="far fa-user mr-1"></i> ${t.author_name} <span class="opacity-60">(${t.author_college || 'Independent'})</span></span>
                            <span class="text-sm text-gray-400"><i class="far fa-clock mr-1"></i> ${new Date(t.createdAt).toLocaleDateString()}</span>
                        </div>
                        <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2 hover:text-primary-600 transition-colors">${escapeHTML(t.title)}</h3>
                        <p class="text-gray-500 dark:text-gray-400 text-sm line-clamp-2">${escapeHTML(t.content)}</p>
                        
                        <div class="flex items-center gap-4 text-sm mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                            <span class="text-gray-500"><i class="far fa-comment-alt mr-1"></i> ${t.reply_count} Replies</span>
                            <span class="text-gray-400"><i class="far fa-eye mr-1"></i> ${t.views} Views</span>
                        </div>
                    </div>
                `;
            });

        } catch (error) {
            console.error('Error fetching threads:', error);
            loader.innerHTML = `<div class="text-red-500 py-4">Network error. Failed to load discussions.</div>`;
        }
    }

    // Initial Load
    loadThreads();
}

window.deleteThread = async function(id, e) {
    if(e) e.stopPropagation();
    if(!confirm("Are you sure you want to delete this thread? This action cannot be undone by SuperAdmin.")) return;

    try {
        const res = await fetch(`/api/forum/threads/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if(data.success) {
            window.location.reload();
        } else {
            alert(data.message || 'Error deleting thread');
        }
    } catch(err) {
        alert("Network error.");
    }
}

// ==========================================
// PAGE: CREATE THREAD
// ==========================================
function initCreateThread() {
    const form = document.getElementById('createThreadForm');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const title = document.getElementById('threadTitle').value.trim();
        const topic = document.getElementById('threadTopic').value;
        const content = document.getElementById('threadContent').value.trim();

        if(!title || !content) return;

        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerText = 'Posting...';

        try {
            const res = await fetch('/api/forum/threads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, topic, content })
            });
            const data = await res.json();
            
            if(data.success) {
                // Redirect to new thread
                window.location.href = `/forum/thread.html?id=${data.thread_id}`;
            } else {
                alert(data.message || "Failed to create thread.");
                btn.disabled = false;
                btn.innerText = 'Post Thread';
            }
        } catch (error) {
            console.error(error);
            alert("Network error.");
            btn.disabled = false;
            btn.innerText = 'Post Thread';
        }
    });
}

// ==========================================
// PAGE: THREAD DETAIL
// ==========================================
function initThreadDetail() {
    const urlParams = new URLSearchParams(window.location.search);
    const threadId = urlParams.get('id');

    if(!threadId) {
        window.location.href = '/forum/forum.html';
        return;
    }

    const threadOp = document.getElementById('threadOp');
    const replyCountUi = document.getElementById('replyCount');
    const repliesContainer = document.getElementById('repliesContainer');

    function renderReplies(replies) {
        replyCountUi.innerText = replies.length;
        repliesContainer.innerHTML = '';

        if(replies.length === 0) {
            repliesContainer.innerHTML = `<div class="bg-white dark:bg-gray-800 rounded-xl p-6 text-center text-gray-500 border dark:border-gray-700">No answers yet. Be the first!</div>`;
            return;
        }

        replies.forEach(r => {
            const score = r.upvotes - r.downvotes;
            const upActive = r.user_vote === 1 ? 'text-primary-600 bg-primary-100 dark:bg-primary-900/50' : 'text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-gray-700';
            const downActive = r.user_vote === -1 ? 'text-red-600 bg-red-100 dark:bg-red-900/50' : 'text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700';

            let deleteBtnHTML = '';
            if(currentUser && currentUser.role === 'superadmin') {
                deleteBtnHTML = `<button onclick="deleteReply(${r.id})" class="text-xs text-red-500 hover:underline"><i class="fas fa-trash"></i> Delete</button>`;
            }

            repliesContainer.innerHTML += `
                <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 transition-all flex gap-4">
                    
                    <!-- Vote Controls -->
                    <div class="flex flex-col items-center min-w-[40px]">
                        <button onclick="toggleVote(${r.id}, 1)" class="w-8 h-8 rounded-full flex items-center justify-center transition-colors ${upActive}"><i class="fas fa-arrow-up"></i></button>
                        <span class="font-bold text-gray-700 dark:text-gray-200 my-1">${score}</span>
                        <button onclick="toggleVote(${r.id}, -1)" class="w-8 h-8 rounded-full flex items-center justify-center transition-colors ${downActive}"><i class="fas fa-arrow-down"></i></button>
                    </div>

                    <!-- Content -->
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between mb-2">
                            <div class="text-sm text-gray-500"><b class="text-gray-800 dark:text-white">${r.author_name}</b> <span class="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-xs ml-2">${r.author_role.toUpperCase()}</span></div>
                            <div class="text-xs text-gray-400 flex items-center gap-3">
                                <span>${new Date(r.createdAt).toLocaleString()}</span>
                                ${deleteBtnHTML}
                            </div>
                        </div>
                        <div class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">${escapeHTML(r.content)}</div>
                    </div>
                </div>
            `;
        });
    }

    async function fetchThread() {
        try {
            const res = await fetch(`/api/forum/threads/${threadId}`);
            const data = await res.json();
            
            if(!data.success) {
                threadOp.innerHTML = `<div class="text-red-500 text-center py-10">Thread not found or deleted.</div>`;
                return;
            }

            const t = data.thread;
            const badgeColor = getBadgeColor(t.topic);

            threadOp.innerHTML = `
                <div class="flex items-center space-x-3 mb-4">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeColor}">${t.topic.toUpperCase()}</span>
                    <span class="text-sm text-gray-500 dark:text-gray-400"><i class="far fa-user mr-1"></i> <b>${t.author_name}</b> </span>
                    <span class="text-sm text-gray-400"><i class="far fa-clock mr-1"></i> ${new Date(t.createdAt).toLocaleString()}</span>
                    <span class="text-sm text-gray-400 ml-auto"><i class="far fa-eye mr-1"></i> ${t.views} Views</span>
                </div>
                <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">${escapeHTML(t.title)}</h1>
                <div class="text-gray-700 dark:text-gray-300 whitespace-pre-wrap pb-4">${escapeHTML(t.content)}</div>
            `;

            renderReplies(data.replies);

        } catch (error) {
            console.error(error);
            threadOp.innerHTML = `<div class="text-red-500">Error loading thread.</div>`;
        }
    }

    // Handle Reply submission
    const form = document.getElementById('replyForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = document.getElementById('replyContent').value.trim();
        if(!content) return;

        const btn = form.querySelector('button');
        btn.disabled = true;

        try {
            const res = await fetch('/api/forum/replies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ thread_id: threadId, content })
            });
            const data = await res.json();
            if(data.success) {
                document.getElementById('replyContent').value = '';
                fetchThread(); // Reload to show new reply at bottom initially (0 votes)
            } else {
                alert(data.message || 'Error posting reply');
            }
        } catch(err) {
            console.error(err);
        } finally {
            btn.disabled = false;
        }
    });

    // Expose toggleVote globally for inline onclick
    window.toggleVote = async function(replyId, type) {
        try {
            const res = await fetch('/api/forum/replies/vote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reply_id: replyId, vote_type: type })
            });
            const data = await res.json();
            if(data.success) {
                // Just reload thread silently to get exact precise ranked ordering & DB count
                fetchThread();
            } else {
                alert('Error processing vote');
            }
        } catch(err) {
            console.error(err);
        }
    }

    window.deleteReply = async function(replyId) {
        if(!confirm("Are you sure you want to delete this reply?")) return;
        try {
            const res = await fetch(`/api/forum/replies/${replyId}`, { method: 'DELETE' });
            const data = await res.json();
            if(data.success) {
                fetchThread();
            } else {
                alert(data.message || 'Error deleting reply');
            }
        } catch(err) {
            console.error(err);
        }
    }

    // Initial
    fetchThread();
}

// ==========================================
// UTILS
// ==========================================
function escapeHTML(str) {
    str = String(str ?? '');
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function getBadgeColor(topic) {
    switch(topic) {
        case 'web': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
        case 'backend': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
        case 'algo': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
        default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
}
