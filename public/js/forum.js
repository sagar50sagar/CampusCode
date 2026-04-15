// ==========================================
// FORUM CLIENT LOGIC
// ==========================================

let currentUser = null;
let currentNavConfig = null;
let forumTopics = [];

document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();

    // 1. Identify the current page based on content IDs or path
    const path = window.location.pathname;

    if (document.getElementById('threadsContainer') || path.includes('forum.html')) {
        initForumListing();
    } else if (document.getElementById('createThreadForm') || path.includes('create.html')) {
        initCreateThread();
    } else if (document.getElementById('threadContentArea') || path.includes('thread.html')) {
        initThreadDetail();
    }

    // 2. Fetch user context in the background to avoid blocking UI initialization
    fetchUserContext();
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
            // Keep legacy forum layout behavior; do not rebuild role shells/sidebar dynamically.
            applyLegacyForumUser();
            renderRoleSidebar();
            bindProfileOverlay();
            bindNotificationDropdown();
        } else {
            // Not logged in -> Redirect home/login
            window.location.href = '/';
        }
    } catch (error) {
        console.error("Error fetching user session:", error);
    }
}

function applyLegacyForumUser() {
    if (!currentUser) return;
    const fullName = currentUser.fullName || 'User';
    const roleLabel = String(currentUser.role || 'User');
    const initials = fullName.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';
    setText('userNameHeader', fullName);
    setText('sidebarName', fullName);
    setText('sidebarRole', roleLabel);
    ['headerAvatar', 'profileAvatarLarge'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = initials;
    });
    setText('profileName', fullName);
    setText('profileMeta', `${roleLabel}${currentUser.collegeName ? ` · ${currentUser.collegeName}` : ''}`);
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    if (sidebarAvatar) sidebarAvatar.textContent = initials;
}

function initializeTheme() {
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }

    const themeToggle = document.getElementById('themeToggle') || document.getElementById('themeToggleBtn');
    if (themeToggle && themeToggle.dataset.bound !== 'true') {
        themeToggle.dataset.bound = 'true';
        themeToggle.addEventListener('click', toggleTheme);
    }

    syncThemeIcon();

    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn') || document.getElementById('sidebarBrandBtn');
    if (sidebarToggleBtn && !sidebarToggleBtn.dataset.bound) {
        sidebarToggleBtn.dataset.bound = 'true';
        sidebarToggleBtn.addEventListener('click', toggleSidebar);
    }
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    syncThemeIcon();
}

window.toggleTheme = toggleTheme;

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
                { href: '/student/forum', icon: 'fas fa-comments', label: 'Community', key: 'community' },
                { href: '/student/stats', icon: 'fas fa-list', label: 'Stats', key: 'stats' },
                { href: '/student/report', icon: 'fas fa-chart-pie', label: 'Report', key: 'report' },
                { href: '/student/profile', icon: 'fas fa-user', label: 'Profile', key: 'profile' }
            ]
        },
        individual: {
            dashboard: '/individual/dashboard',
            label: 'Individual',
            items: [
                { href: '/individual/dashboard', icon: 'fas fa-home', label: 'Home', key: 'dashboard' },
                { href: '/individual/problems', icon: 'fas fa-tasks', label: 'Problems', key: 'problems' },
                { href: '/individual/contest', icon: 'fas fa-trophy', label: 'Contests', key: 'contests' },
                { href: '/individual/forum', icon: 'fas fa-comments', label: 'Community', key: 'community' },
                { href: '/individual/stats', icon: 'fas fa-list', label: 'Stats', key: 'stats' },
                { href: '/individual/report', icon: 'fas fa-chart-pie', label: 'Report', key: 'report' },
                { href: '/individual/profile', icon: 'fas fa-user', label: 'Profile', key: 'profile' }
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
        } else if (normalizedRole === 'individual') {
            profileLink.href = '/individual/profile';
            profileLink.classList.remove('hidden');
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

    // Automatically rewrite all back links globally so users don't get stuck in the wrong shell
    const forumLinkObj = currentNavConfig?.items.find(item => item.key === 'community');
    if (forumLinkObj) {
        document.querySelectorAll('a[href="/forum/forum.html"]').forEach(link => {
            link.href = forumLinkObj.href;
        });
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
        const isActive = isCommunity ? currentPath.includes('/forum') : currentPath === item.href;
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
    const toggleIcon = document.querySelector('#sidebarToggleBtn i, #sidebarBrandBtn i');

    if (!sidebar) return;

    sidebar.classList.toggle('collapsed');
    if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.replace('w-64', 'w-20');
        if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
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
        if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
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

function bindNotificationDropdown() {
    const notificationBtn = document.getElementById('notificationBtn');
    const notificationDropdown = document.getElementById('notificationDropdown');

    if (!notificationBtn || !notificationDropdown || notificationDropdown.dataset.bound === 'true') return;
    notificationDropdown.dataset.bound = 'true';

    notificationBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        notificationDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (event) => {
        if (!notificationDropdown.contains(event.target) && !notificationBtn.contains(event.target)) {
            notificationDropdown.classList.add('hidden');
        }
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
    const topicCardsContainer = document.getElementById('topicCardsContainer');
    const addTopicBtn = document.getElementById('addTopicBtn');
    const topicModal = document.getElementById('topicModal');
    const closeTopicModalBtn = document.getElementById('closeTopicModalBtn');
    const topicForm = document.getElementById('topicForm');
    const topicNameInput = document.getElementById('topicNameInput');
    const topicSlugInput = document.getElementById('topicSlugInput');
    const topicIconInput = document.getElementById('topicIconInput');
    const topicFormMsg = document.getElementById('topicFormMsg');

    if (!searchInput || !filterGlobal || !filterCollege || !sortSelect) {
        return;
    }

    const isSuperadmin = String(currentUser?.role || '').toLowerCase() === 'superadmin';
    if (addTopicBtn && isSuperadmin) addTopicBtn.classList.remove('hidden');

    const topicClassBySlug = {
        algo: 'text-yellow-500',
        web: 'text-blue-500',
        backend: 'text-green-500',
        general: 'text-primary-500'
    };

    const getTopicIconClass = (topic) => {
        const raw = String(topic?.icon || '').trim();
        if (raw && raw.includes('fa')) return raw;
        return 'fas fa-hashtag';
    };

    const getTopicTextClass = (topic) => topicClassBySlug[String(topic?.slug || '').toLowerCase()] || 'text-primary-500';

    const renderTopicCards = () => {
        if (!topicCardsContainer) return;
        const allCard = `
            <div class="topic-card selected bg-white dark:bg-gray-800 rounded-2xl p-6 border border-primary-100 dark:border-gray-700 text-center" data-topic="all">
                <i class="fas fa-layer-group text-2xl text-primary-500"></i>
                <p class="mt-3 text-xl font-bold text-gray-800 dark:text-gray-100">All Topics</p>
            </div>
        `;

        const dynamicCards = forumTopics.map((topic) => `
            <div class="topic-card bg-white dark:bg-gray-800 rounded-2xl p-6 border border-primary-100 dark:border-gray-700 text-center" data-topic="${escapeHTML(topic.slug)}">
                <i class="${escapeHTML(getTopicIconClass(topic))} text-2xl ${escapeHTML(getTopicTextClass(topic))}"></i>
                <p class="mt-3 text-xl font-bold text-gray-800 dark:text-gray-100">${escapeHTML(topic.name)}</p>
            </div>
        `).join('');

        topicCardsContainer.innerHTML = allCard + dynamicCards;
        bindTopicCardEvents();
    };

    const bindTopicCardEvents = () => {
        const topicCards = document.querySelectorAll('.topic-card');
        topicCards.forEach(card => {
            card.addEventListener('click', () => {
                topicCards.forEach(t => t.classList.remove('selected'));
                card.classList.add('selected');
                currentTopic = card.dataset.topic || 'all';
                loadThreads();
            });
        });
    };

    const loadTopics = async () => {
        try {
            const res = await fetch('/api/forum/topics');
            const data = await res.json();
            if (data.success && Array.isArray(data.topics)) {
                forumTopics = data.topics;
            } else {
                forumTopics = [];
            }
        } catch (err) {
            console.error('Error loading forum topics:', err);
            forumTopics = [];
        }
        renderTopicCards();
    };

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

    if (addTopicBtn && topicModal && isSuperadmin) {
        addTopicBtn.addEventListener('click', () => {
            topicForm?.reset();
            if (topicFormMsg) topicFormMsg.classList.add('hidden');
            topicModal.classList.remove('hidden');
            topicModal.classList.add('flex');
        });
    }

    if (closeTopicModalBtn && topicModal) {
        closeTopicModalBtn.addEventListener('click', () => {
            topicModal.classList.add('hidden');
            topicModal.classList.remove('flex');
        });
    }

    if (topicModal) {
        topicModal.addEventListener('click', (event) => {
            if (event.target === topicModal) {
                topicModal.classList.add('hidden');
                topicModal.classList.remove('flex');
            }
        });
    }

    if (topicForm && isSuperadmin) {
        topicForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const name = String(topicNameInput?.value || '').trim();
            const slug = String(topicSlugInput?.value || '').trim();
            const icon = String(topicIconInput?.value || '').trim();
            if (!name) return;

            try {
                const res = await fetch('/api/forum/topics', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, slug, icon })
                });
                const data = await res.json();
                if (!data.success) {
                    if (topicFormMsg) {
                        topicFormMsg.textContent = data.message || 'Unable to create topic';
                        topicFormMsg.className = 'text-sm text-red-500';
                    }
                    return;
                }

                if (topicModal) {
                    topicModal.classList.add('hidden');
                    topicModal.classList.remove('flex');
                }
                await loadTopics();
            } catch (err) {
                console.error('Create topic error:', err);
                if (topicFormMsg) {
                    topicFormMsg.textContent = 'Network error while creating topic.';
                    topicFormMsg.className = 'text-sm text-red-500';
                }
            }
        });
    }

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

                const prefixMatch = window.location.pathname.match(/^(\/(?:faculty|student|hos|college\/hod))/);
                const prefix = prefixMatch ? prefixMatch[1] : '';

                container.innerHTML += `
                    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-all cursor-pointer p-6 relative" 
                         onclick="window.location.href='${prefix}/forum/thread?id=${t.id}'">
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
    loadTopics().then(loadThreads);
}

window.deleteThread = async function(id, e) {
    if(e) e.stopPropagation();
    if(!confirm("Are you sure you want to delete this thread? This action cannot be undone.")) return;

    try {
        const res = await fetch(`/api/forum/threads/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if(data.success) {
            if (window.location.pathname.includes('thread.html')) {
                const forumLinkObj = currentNavConfig?.items.find(item => item.key === 'community');
                window.location.href = forumLinkObj ? forumLinkObj.href : '/forum/forum.html';
            } else {
                window.location.reload();
            }
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
    const threadTopicSelect = document.getElementById('threadTopic');

    const loadCreateTopics = async () => {
        if (!threadTopicSelect) return;
        try {
            const res = await fetch('/api/forum/topics');
            const data = await res.json();
            if (!data.success || !Array.isArray(data.topics)) return;

            threadTopicSelect.innerHTML = '';
            data.topics.forEach((topic) => {
                const option = document.createElement('option');
                option.value = topic.slug;
                option.textContent = topic.name;
                threadTopicSelect.appendChild(option);
            });
        } catch (err) {
            console.error('Error loading thread topics:', err);
        }
    };

    loadCreateTopics();
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const titleEl = document.getElementById('threadTitle') || document.getElementById('title');
        const title = titleEl ? titleEl.value.trim() : '';
        
        let topic = '';
        const topicSelect = document.getElementById('threadTopic');
        if (topicSelect) {
            topic = topicSelect.value;
        } else {
            const topicRadio = document.querySelector('input[name="topic"]:checked');
            if (topicRadio) topic = topicRadio.value;
        }

        const contentEl = document.getElementById('threadContent') || document.getElementById('content');
        const content = contentEl ? contentEl.value.trim() : '';

        if(!title || !content) return;

        const btn = document.getElementById('submitBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Posting...';

        try {
            const res = await fetch('/api/forum/threads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, topic, content })
            });

            const data = await res.json();
            if(data.success) {
                // Return securely to the user's explicit module wrapper URL Instead of the global thread.html
                const prefixMatch = window.location.pathname.match(/^(\/(?:faculty|student|hos|college\/hod))/);
                const prefix = (prefixMatch && prefixMatch[1]) ? prefixMatch[1] : '';
                
                // Return to the main forum listing page instead of the specific thread
                window.location.replace(`${prefix}/forum`);
            } else {
                alert(data.message || 'Error creating thread');
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Post Discussion';
            }
        } catch (error) {
            console.error(error);
            alert("Network error.");
            btn.disabled = false;
            btn.innerHTML = 'Post Thread';
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
    const replyCountUi = document.getElementById('replyCount') || document.getElementById('replyCountTitle');
    const repliesContainer = document.getElementById('repliesContainer');

    function renderReplies(replies) {
        if(replyCountUi) {
            replyCountUi.innerText = replies.length + (replies.length === 1 ? ' Reply' : ' Replies');
        }
        if(!repliesContainer) return;
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
                if(threadOp) threadOp.innerHTML = `<div class="text-red-500 text-center py-10">Thread not found or deleted.</div>`;
                return;
            }

            const t = data.thread;
            const badgeColor = getBadgeColor(t.topic);

            // Handle New Role-Based Templates (If elements exist)
            const titleEl = document.getElementById('threadTitle');
            const bodyEl = document.getElementById('threadBody');
            const opNameEl = document.getElementById('opName');
            const opRoleEl = document.getElementById('opRole');
            const opTopicEl = document.getElementById('opTopic');
            const opDateEl = document.getElementById('opDate');
            const loadingState = document.getElementById('loadingState');
            const contentArea = document.getElementById('threadContentArea');

            if (titleEl && bodyEl) {
                // Populate granular fields
                if(titleEl) titleEl.innerText = t.title;
                if(bodyEl) {
                    if (window.marked && window.DOMPurify) {
                        bodyEl.innerHTML = window.DOMPurify.sanitize(window.marked.parse(t.content));
                    } else {
                        bodyEl.innerText = t.content;
                    }
                }
                if(opNameEl) opNameEl.innerText = t.author_name;
                if(opRoleEl) opRoleEl.innerText = String(t.author_role).toUpperCase();
                if(opTopicEl) opTopicEl.innerText = String(t.topic).toUpperCase();
                if(opDateEl) opDateEl.innerText = new Date(t.createdAt).toLocaleString();
                
                // Toggle visibility
                if(loadingState) loadingState.classList.add('hidden');
                if(contentArea) contentArea.classList.remove('hidden');

                // Update votes/stats if IDs exist
                const upCount = document.getElementById('upvoteCount');
                const downCount = document.getElementById('downvoteCount');
                if(upCount) upCount.innerText = t.upvotes || 0;
                if(downCount) downCount.innerText = t.downvotes || 0;

                const deleteBtn = document.getElementById('deleteThreadBtn');
                if (deleteBtn && currentUser && currentUser.role === 'superadmin') {
                    deleteBtn.classList.remove('hidden');
                    deleteBtn.onclick = () => deleteThread(t.id);
                }

                const opAvatar = document.getElementById('opAvatar');
                if (opAvatar) {
                    const initials = t.author_name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'U';
                    opAvatar.innerText = initials;
                }

                // --- Thread Voting Listeners & Active States ---
                const upBtn = document.getElementById('upvoteBtn');
                const downBtn = document.getElementById('downvoteBtn');

                if (upBtn && downBtn) {
                    // Update active colors based on user_vote
                    // user_vote: 1 (up), -1 (down), 0 or null (none)
                    const upActive = t.user_vote === 1;
                    const downActive = t.user_vote === -1;

                    upBtn.className = `flex items-center gap-2 transition-colors font-semibold text-sm px-3 py-1.5 rounded-lg border ${upActive ? 'text-primary-600 bg-primary-100 border-primary-300 dark:bg-primary-900/50 dark:text-primary-400' : 'text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 bg-gray-50 dark:bg-gray-700/50 hover:bg-primary-50 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-600'}`;
                    downBtn.className = `flex items-center gap-2 transition-colors font-semibold text-sm px-3 py-1.5 rounded-lg border ${downActive ? 'text-red-600 bg-red-100 border-red-300 dark:bg-red-900/50 dark:text-red-400' : 'text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 bg-gray-50 dark:bg-gray-700/50 hover:bg-primary-50 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-600'}`;

                    // Bind events
                    upBtn.onclick = () => toggleThreadVote(1);
                    downBtn.onclick = () => toggleThreadVote(-1);
                }

            } else if (threadOp) {
                // Legacy Global Logic
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
            }

            renderReplies(data.replies);

        } catch (error) {
            console.error(error);
            if(threadOp) threadOp.innerHTML = `<div class="text-red-500">Error loading thread.</div>`;
        }
    }

    // Helper to toggle thread-level votes
    async function toggleThreadVote(type) {
        const action = type === 1 ? 'upvote' : 'downvote';
        try {
            const res = await fetch(`/api/forum/threads/${threadId}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if(data.success) {
                // Update UI counts immediately for responsiveness, then refresh
                const upCount = document.getElementById('upvoteCount');
                const downCount = document.getElementById('downvoteCount');
                if (upCount) upCount.innerText = data.upvotes;
                if (downCount) downCount.innerText = data.downvotes;
                fetchThread();
            } else {
                alert('Error processing thread vote');
            }
        } catch(err) {
            console.error("Thread vote error:", err);
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
