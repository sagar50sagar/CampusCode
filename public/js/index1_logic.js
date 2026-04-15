
document.addEventListener("DOMContentLoaded", function () {

    // --- Navigation Logic ---
    const navItems = document.querySelectorAll('.nav-item[data-target]');
    const sections = document.querySelectorAll('.content-section');
    const pageTitle = document.getElementById('page-title');

    // --- Sidebar Toggle Logic ---
    const sidebar = document.getElementById('mainSidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    if (toggleBtn && sidebar) {
        const toggleIcon = toggleBtn.querySelector('i');
        const sidebarLogoText = document.getElementById('sidebarLogoText');
        const headerLogoText = document.getElementById('headerLogoText');
        const sidebarHeader = document.getElementById('sidebarHeader');
        const sidebarLogoIcon = document.getElementById('sidebarLogoIcon');

        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            if (sidebar.classList.contains('collapsed')) {
                sidebar.classList.replace('w-64', 'w-20');
                if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';

                if (sidebarHeader) sidebarHeader.classList.replace('p-6', 'p-2');
                if (sidebarLogoIcon) sidebarLogoIcon.style.display = 'none';

                if (sidebarLogoText) {
                    sidebarLogoText.textContent = 'CC';
                    sidebarLogoText.style.opacity = '1';
                    sidebarLogoText.style.width = 'auto';
                }
                if (headerLogoText) {
                    headerLogoText.classList.remove('hidden');
                    setTimeout(() => headerLogoText.classList.remove('opacity-0', '-translate-x-2'), 50);
                }
            } else {
                sidebar.classList.replace('w-20', 'w-64');
                if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';

                if (sidebarHeader) sidebarHeader.classList.replace('p-2', 'p-6');
                if (sidebarLogoIcon) sidebarLogoIcon.style.display = '';

                if (sidebarLogoText) {
                    sidebarLogoText.textContent = 'CampusCode';
                    sidebarLogoText.style.opacity = '1';
                    sidebarLogoText.style.width = 'auto';
                }
                if (headerLogoText) {
                    headerLogoText.classList.add('opacity-0', '-translate-x-2');
                    setTimeout(() => headerLogoText.classList.add('hidden'), 300);
                }
            }
        });
    }

    function showSection(targetId) {
        sections.forEach(sec => sec.classList.add('hidden'));
        const targetSec = document.getElementById(targetId);
        if (targetSec) targetSec.classList.remove('hidden');

        navItems.forEach(item => {
            if (item.dataset.target === targetId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        if (pageTitle) {
            const titleMap = {
                'section-dashboard': 'Dashboard',
                'section-manage-problems': 'Manage Problems',
                'section-manage-contests': 'Manage Contests',
                'section-forum': 'Community Forum',
                'section-manage-class': 'Class Management',
                'section-tasks': 'Task Management',
                'section-settings': 'Settings',
                'section-support': 'Help & Support',
                'section-reports': 'Custom Reports'
            };
            pageTitle.textContent = titleMap[targetId] || 'Dashboard';
        }
    }

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = item.dataset.target;
            if (target) showSection(target);
        });
    });

    // --- Theme Toggle ---
    const themeBtn = document.getElementById('themeToggleBtn');
    const themeIcon = themeBtn ? themeBtn.querySelector('i') : null;
    const html = document.documentElement;

    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        html.classList.add('dark');
        if (themeIcon) themeIcon.classList.replace('fa-moon', 'fa-sun');
    }

    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            html.classList.toggle('dark');
            if (html.classList.contains('dark')) {
                localStorage.theme = 'dark';
                if (themeIcon) themeIcon.classList.replace('fa-moon', 'fa-sun');
            } else {
                localStorage.theme = 'light';
                if (themeIcon) themeIcon.classList.replace('fa-sun', 'fa-moon');
            }
        });
    }

    // --- Notification Dropdown ---
    const notifBtn = document.getElementById('notificationBtn');
    const notifDropdown = document.getElementById('notificationDropdown');

    if (notifBtn && notifDropdown) {
        notifBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifDropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!notifDropdown.contains(e.target) && !notifBtn.contains(e.target)) {
                notifDropdown.classList.add('hidden');
            }
        });
    }

    // --- Profile Overlay ---
    const overlay = document.getElementById("profileOverlay");
    const navProfileBtn = document.getElementById("navProfileBtn");
    const headerProfileBtn = document.getElementById("headerProfileBtn");
    const popupProfileBtn = document.getElementById("popupProfileBtn");
    const closeBtn = document.getElementById("closeProfileOverlay");
    const closeBtnBottom = document.getElementById("closeProfileBtnBottom");

    function openProfile() {
        if (overlay) overlay.classList.remove("hidden");
        // Close settings popup if open
        const settingsPopup = document.getElementById('settingsPopupMenu');
        if (settingsPopup) settingsPopup.classList.add('hidden');
    }
    function closeProfile() { if (overlay) overlay.classList.add("hidden"); }

    if (navProfileBtn) navProfileBtn.addEventListener("click", openProfile);
    if (headerProfileBtn) headerProfileBtn.addEventListener("click", openProfile);
    if (popupProfileBtn) popupProfileBtn.addEventListener("click", openProfile);
    if (closeBtn) closeBtn.addEventListener("click", closeProfile);
    if (closeBtnBottom) closeBtnBottom.addEventListener("click", closeProfile);

    if (overlay) {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeProfile();
        });
    }

    // --- Logout Functionality ---
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Redirect to login page
            window.location.href = '/auth/logout';
        });
    }

    // --- Settings Popup Menu ---
    const settingsBtn = document.getElementById('btn-settings-menu');
    const settingsPopup = document.getElementById('settingsPopupMenu');

    if (settingsBtn && settingsPopup) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsPopup.classList.toggle('hidden');
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!settingsPopup.contains(e.target) && !settingsBtn.contains(e.target)) {
                settingsPopup.classList.add('hidden');
            }
        });

        // Optional: Close when clicking a menu item
        settingsPopup.querySelectorAll('button, a').forEach(item => {
            item.addEventListener('click', () => {
                settingsPopup.classList.add('hidden');
            });
        });
    }


    // --- Problem Section Logic ---
    const problemTabs = document.querySelectorAll('.problem-tab');
    const problemTabContents = document.querySelectorAll('.problem-tab-content');

    problemTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            problemTabs.forEach(t => t.classList.remove('active', 'border-primary-500', 'text-primary-600'));
            tab.classList.add('active', 'border-primary-500', 'text-primary-600');

            const target = tab.dataset.tab;
            problemTabContents.forEach(content => {
                if (content.id === target) content.classList.remove('hidden');
                else content.classList.add('hidden');
            });
        });
    });

    const btnCreateProblem = document.getElementById('btn-create-problem');
    const problemsListContainer = document.getElementById('problems-list-container');
    const problemFormView = document.getElementById('problem-form-view');
    const btnBackToList = document.getElementById('btn-back-to-list');
    const btnCancelProblem = document.getElementById('btn-cancel-problem');

    // Show problem form
    if (btnCreateProblem) {
        btnCreateProblem.addEventListener('click', () => {
            problemsListContainer.classList.add('hidden');
            problemFormView.classList.remove('hidden');
        });
    }

    // Close problem form (shared function for both back and cancel)
    function closeProblemForm(e) {
        if (e) e.preventDefault();
        if (problemFormView) problemFormView.classList.add('hidden');
        if (problemsListContainer) problemsListContainer.classList.remove('hidden');
    }

    if (btnBackToList) {
        btnBackToList.addEventListener('click', closeProblemForm);
    }

    if (btnCancelProblem) {
        btnCancelProblem.addEventListener('click', closeProblemForm);
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.bookmark-btn');
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon.classList.contains('far')) {
                icon.classList.remove('far');
                icon.classList.add('fas', 'text-yellow-400');
            } else {
                icon.classList.add('far');
                icon.classList.remove('fas', 'text-yellow-400');
            }
        }
    });

    // --- Task Page Logic ---
    const taskInput = document.getElementById('newTaskInput');
    const addTaskBtn = document.getElementById('addTaskBtn');
    const taskList = document.getElementById('taskList');

    if (addTaskBtn && taskInput && taskList) {
        addTaskBtn.addEventListener('click', () => {
            const text = taskInput.value.trim();
            if (text) {
                const li = document.createElement('li');
                li.className = "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg group";
                li.innerHTML = `
                    <div class="flex items-center gap-3">
                        <input type="checkbox" class="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500">
                        <span class="text-sm text-gray-700 dark:text-gray-200">${text}</span>
                    </div>
                    <button class="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity delete-task-btn">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                `;
                taskList.appendChild(li);
                taskInput.value = '';
            }
        });

        taskInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') addTaskBtn.click();
        });

        taskList.addEventListener('click', (e) => {
            if (e.target.closest('.delete-task-btn')) {
                e.target.closest('li').remove();
            }
        });
    }
    // --- Contest Logic ---
    const btnCreateContest = document.getElementById('btn-create-contest');
    const contestFormView = document.getElementById('contest-form-view');
    const sectionManageContests = document.getElementById('section-manage-contests');
    const btnBackToContestList = document.getElementById('btn-back-to-contest-list');
    const btnCancelContest = document.getElementById('btn-cancel-contest');

    // Show contest form
    if (btnCreateContest && contestFormView && sectionManageContests) {
        btnCreateContest.addEventListener('click', () => {
            sectionManageContests.classList.add('hidden');
            contestFormView.classList.remove('hidden');
        });
    }

    // Close contest form (shared function for both back and cancel)
    function closeContestForm(e) {
        if (e) e.preventDefault();
        if (contestFormView) contestFormView.classList.add('hidden');
        if (sectionManageContests) sectionManageContests.classList.remove('hidden');

        // Reset to Upcoming Contests tab
        const tabUpcoming = document.getElementById('contest-tab-upcoming');
        const tabPast = document.getElementById('contest-tab-past');
        const listUpcoming = document.getElementById('contest-list-upcoming');
        const listPast = document.getElementById('contest-list-past');

        if (tabUpcoming && tabPast && listUpcoming && listPast) {
            tabUpcoming.classList.add('active', 'border-primary-500', 'text-primary-600', 'dark:text-primary-400');
            tabUpcoming.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-300');

            tabPast.classList.remove('active', 'border-primary-500', 'text-primary-600', 'dark:text-primary-400');
            tabPast.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-300');

            listUpcoming.classList.remove('hidden');
            listPast.classList.add('hidden');
        }
    }

    if (btnBackToContestList) {
        btnBackToContestList.addEventListener('click', closeContestForm);
    }

    if (btnCancelContest) {
        btnCancelContest.addEventListener('click', closeContestForm);
    }

    // Contest Tabs
    const contestTabUpcoming = document.getElementById('contest-tab-upcoming');
    const contestTabPast = document.getElementById('contest-tab-past');
    const contestListUpcoming = document.getElementById('contest-list-upcoming');
    const contestListPast = document.getElementById('contest-list-past');

    if (contestTabUpcoming && contestTabPast) {
        contestTabUpcoming.addEventListener('click', () => {
            contestTabUpcoming.classList.add('border-primary-500', 'text-primary-600', 'dark:text-primary-400', 'active');
            contestTabUpcoming.classList.remove('border-transparent', 'text-gray-500');
            contestTabPast.classList.remove('border-primary-500', 'text-primary-600', 'dark:text-primary-400', 'active');
            contestTabPast.classList.add('border-transparent', 'text-gray-500');

            contestListUpcoming.classList.remove('hidden');
            contestListPast.classList.add('hidden');
        });

        contestTabPast.addEventListener('click', () => {
            contestTabPast.classList.add('border-primary-500', 'text-primary-600', 'dark:text-primary-400', 'active');
            contestTabPast.classList.remove('border-transparent', 'text-gray-500');
            contestTabUpcoming.classList.remove('border-primary-500', 'text-primary-600', 'dark:text-primary-400', 'active');
            contestTabUpcoming.classList.add('border-transparent', 'text-gray-500');

            contestListPast.classList.remove('hidden');
            contestListUpcoming.classList.add('hidden');
        });
    }

    // Add Problem to Contest Logic
    const btnAddProblemToContest = document.getElementById('btn-add-problem-to-contest');
    const contestProblemSelect = document.getElementById('contest-problem-select');
    const addedProblemsList = document.getElementById('added-problems-list');

    if (btnAddProblemToContest && contestProblemSelect && addedProblemsList) {
        btnAddProblemToContest.addEventListener('click', () => {
            const problemTitle = contestProblemSelect.value;
            if (problemTitle) {
                // Check if already added? (Optional, but good UX)
                // For now, just append
                const tr = document.createElement('tr');
                tr.className = "group border-b border-gray-100 dark:border-gray-700 last:border-0";
                tr.innerHTML = `
                    <td class="px-4 py-2 text-gray-800 dark:text-gray-200 text-sm">${problemTitle}</td>
                    <td class="px-4 py-2 text-right">
                        <button type="button" class="text-gray-400 hover:text-red-500 transition-colors remove-contest-problem-btn">
                            <i class="fas fa-times"></i>
                        </button>
                    </td>
                `;
                addedProblemsList.appendChild(tr);
                contestProblemSelect.value = ""; // Reset dropdown
            }
        });

        // Remove delegation
        addedProblemsList.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-contest-problem-btn');
            if (btn) {
                btn.closest('tr').remove();
            }
        });
    }
    // --- Dashboard Charts ---
    function initDashboardCharts() {
        // Check if elements exist
        const ctxPerformance = document.getElementById('performanceChart');
        const ctxDifficulty = document.getElementById('difficultyChart');

        if (ctxPerformance && ctxDifficulty) {
            // Chart Global Defaults for Dark/Light theme - adapting to current style
            // We'll style charts to look good on both backgrounds with neutral colors.
            Chart.defaults.color = '#6b7280'; // Gray 500
            Chart.defaults.borderColor = 'rgba(107, 114, 128, 0.1)'; // Gray 500 @ 10%

            // 1. Student Performance Distribution (Bar Chart)
            new Chart(ctxPerformance, {
                type: 'bar',
                data: {
                    labels: ['Excellent', 'Good', 'Average', 'Needs Imp.'],
                    datasets: [{
                        label: 'Students',
                        data: [65, 80, 55, 20],
                        backgroundColor: [
                            '#3b82f6', // Blue
                            '#10b981', // Emerald
                            '#f59e0b', // Amber
                            '#ef4444'  // Red
                        ],
                        borderRadius: 4,
                        maxBarThickness: 30
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: '#1f2937', titleColor: '#fff', bodyColor: '#fff' }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(107, 114, 128, 0.1)' }
                        },
                        x: {
                            grid: { display: false }
                        }
                    }
                }
            });

            // 2. Problem Difficulty vs Solve Rate (Line Chart)
            new Chart(ctxDifficulty, {
                type: 'line',
                data: {
                    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
                    datasets: [
                        {
                            label: 'Easy',
                            data: [85, 88, 92, 95],
                            borderColor: '#3b82f6',
                            tension: 0.4,
                            pointBackgroundColor: '#3b82f6'
                        },
                        {
                            label: 'Medium',
                            data: [60, 65, 58, 70],
                            borderColor: '#f59e0b',
                            tension: 0.4,
                            pointBackgroundColor: '#f59e0b'
                        },
                        {
                            label: 'Hard',
                            data: [30, 35, 40, 45],
                            borderColor: '#ef4444',
                            tension: 0.4,
                            pointBackgroundColor: '#ef4444'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: { color: '#9ca3af', boxWidth: 10 }
                        },
                        tooltip: { backgroundColor: '#1f2937', titleColor: '#fff', bodyColor: '#fff' }
                    },
                    scales: {
                        y: {
                            grid: { color: '#374151' }
                        },
                        x: {
                            grid: { display: false }
                        }
                    }
                }
            });
        }
    }

    // Call init
    // --- Student Search Logic ---
    const studentSearchInput = document.getElementById('studentSearchInput');
    const studentTableBody = document.querySelector('#section-manage-class tbody');
    const btnAddStudent = document.getElementById('btn-add-student');
    const studentListContainer = document.getElementById('student-list-container');
    const studentFormView = document.getElementById('student-form-view');
    const btnBackToStudentList = document.getElementById('btn-back-to-student-list');

    if (btnAddStudent && studentListContainer && studentFormView) {
        btnAddStudent.addEventListener('click', () => {
            studentListContainer.classList.add('hidden');
            studentFormView.classList.remove('hidden');
        });
    }

    if (btnBackToStudentList && studentListContainer && studentFormView) {
        btnBackToStudentList.addEventListener('click', () => {
            studentFormView.classList.add('hidden');
            studentListContainer.classList.remove('hidden');
        });
    }

    if (studentSearchInput && studentTableBody) {
        studentSearchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const rows = studentTableBody.querySelectorAll('tr');

            rows.forEach(row => {
                // Get text content from the row
                const text = row.innerText.toLowerCase();
                // Check if row contains search term
                if (text.includes(searchTerm)) {
                    row.classList.remove('hidden');
                } else {
                    row.classList.add('hidden');
                }
            });
        });
    }






    // --- Dashboard Charts ---
    initDashboardCharts();

    // --- Quill Editor Init ---
    let quill;
    if (document.getElementById('editor-container')) {
        quill = new Quill('#editor-container', {
            theme: 'snow',
            placeholder: 'Write problem description here...',
            modules: {
                toolbar: [
                    ['bold', 'italic', 'underline', 'strike'],
                    ['blockquote', 'code-block'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    [{ 'script': 'sub' }, { 'script': 'super' }],
                    [{ 'indent': '-1' }, { 'indent': '+1' }],
                    [{ 'size': ['small', false, 'large', 'huge'] }],
                    [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'font': [] }],
                    [{ 'align': [] }],
                    ['clean']
                ]
            }
        });
    }

    // --- Forum Logic ---
    const newPostBtn = document.getElementById('newPostBtn');
    const forumListView = document.getElementById('forum-list-view');
    const forumFormView = document.getElementById('forum-form-view');
    const btnCancelPostFooter = document.getElementById('btn-cancel-post-footer');
    const btnBackPost = document.getElementById('btn-back-post');

    if (newPostBtn && forumListView && forumFormView) {
        newPostBtn.addEventListener('click', () => {
            forumListView.classList.add('hidden');
            forumFormView.classList.remove('hidden');
        });
    }

    function closeForumForm() {
        if (forumFormView && forumListView) {
            forumFormView.classList.add('hidden');
            forumListView.classList.remove('hidden');
        }
    }

    if (btnCancelPostFooter) btnCancelPostFooter.addEventListener('click', closeForumForm);
    if (btnBackPost) btnBackPost.addEventListener('click', closeForumForm);

    const forumForm = forumFormView ? forumFormView.querySelector('form') : null;
    if (forumForm) {
        forumForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // Simulate Post
            alert("Discussion posted successfully!");
            forumForm.reset();
            forumFormView.classList.add('hidden');
            forumListView.classList.remove('hidden');
        });
    }



    // --- Reports Logic ---
    const reportTypeSelect = document.getElementById('reportTypeSelect');
    const reportSections = document.querySelectorAll('.report-section');
    const reportDateSpan = document.getElementById('currentDateReport');

    // Check if we are on the reports page (or at least have the main selector)
    if (reportTypeSelect) {

        // Mock Data for New Reports
        const contestData = [
            { id: 1, name: "Weekly Coding Challenge #45", date: "2024-03-15", participants: 156, avgScore: 85, topScorer: "Sagar Kumar", status: "Completed" },
            { id: 2, name: "Weekly Coding Challenge #46", date: "2024-03-22", participants: 142, avgScore: 78, topScorer: "Priya Sharma", status: "Completed" },
            { id: 3, name: "Monthly Hackathon - April", date: "2024-04-05", participants: 320, avgScore: 92, topScorer: "Rahul Verma", status: "Ongoing" },
            { id: 4, name: "Weekly Coding Challenge #47", date: "2024-04-12", participants: 0, avgScore: 0, topScorer: "-", status: "Upcoming" },
            { id: 5, name: "Freshers Coding Contest", date: "2024-02-10", participants: 210, avgScore: 65, topScorer: "New User", status: "Completed" }
        ];

        const problemData = [
            { id: 1, title: "Two Sum", topic: "Arrays", difficulty: "Easy", attempts: 1250, successRate: "85%", avgTime: "15 mins" },
            { id: 2, title: "Add Two Numbers", topic: "Linked List", difficulty: "Medium", attempts: 980, successRate: "60%", avgTime: "25 mins" },
            { id: 3, title: "Median of Two Sorted Arrays", topic: "Arrays", difficulty: "Hard", attempts: 450, successRate: "35%", avgTime: "45 mins" },
            { id: 4, title: "Longest Palindromic Substring", topic: "Strings", difficulty: "Medium", attempts: 850, successRate: "55%", avgTime: "30 mins" },
            { id: 5, title: "Valid Parentheses", topic: "Stack", difficulty: "Easy", attempts: 1500, successRate: "90%", avgTime: "10 mins" }
        ];

        const overallData = [
            { department: "CSE", totalStudents: 450, activeStudents: 380, problemsSolved: 12500, participation: "85%", avgRating: 1650 },
            { department: "ECE", totalStudents: 320, activeStudents: 150, problemsSolved: 4200, participation: "45%", avgRating: 1420 },
            { department: "ME", totalStudents: 280, activeStudents: 80, problemsSolved: 1500, participation: "25%", avgRating: 1350 },
            { department: "CE", totalStudents: 250, activeStudents: 60, problemsSolved: 900, participation: "20%", avgRating: 1280 }
        ];

        const columnContainers = {
            'student': document.getElementById('cols-student'),
            'contest': document.getElementById('cols-contest'),
            'problem': document.getElementById('cols-problem'),
            'overall': document.getElementById('cols-overall')
        };

        if (reportDateSpan) reportDateSpan.innerText = new Date().toLocaleDateString('en-GB');

        // Event Listeners
        reportTypeSelect.addEventListener('change', initReportUI);

        const clearBtns = {
            contest: document.getElementById('clearContestFiltersBtn'),
            problem: document.getElementById('clearProblemFiltersBtn'),
            overall: document.getElementById('clearOverallFiltersBtn')
        };
        if (clearBtns.contest) {
            clearBtns.contest.addEventListener('click', () => {
                const s = document.getElementById('contestSearchInput');
                const f = document.getElementById('contestStatusFilter');
                const so = document.getElementById('contestSortFilter');
                if (s) s.value = '';
                if (f) f.value = '';
                if (so) so.value = 'recent';
                populateContestTable();
            });
        }
        if (clearBtns.problem) {
            clearBtns.problem.addEventListener('click', () => {
                const s = document.getElementById('problemSearchInput');
                const f = document.getElementById('problemDifficultyFilter');
                const t = document.getElementById('problemTopicFilter');
                const so = document.getElementById('problemSortFilter');
                if (s) s.value = '';
                if (f) f.value = '';
                if (t) t.value = '';
                if (so) so.value = 'recent';
                populateProblemTable();
            });
        }
        if (clearBtns.overall) {
            clearBtns.overall.addEventListener('click', () => {
                const s = document.getElementById('overallSearchInput');
                const so = document.getElementById('overallSortFilter');
                if (s) s.value = '';
                if (so) so.value = 'rating';
                populateOverallTable();
            });
        }

        // Initial Call
        setTimeout(initReportUI, 0); // Defer slightly to ensure DOM 

        function initReportUI() {
            const selectedType = reportTypeSelect.value || 'student';

            // 1. Show relevant Section
            reportSections.forEach(sec => {
                if (sec.id === `report-section-${selectedType}`) {
                    sec.classList.remove('hidden');
                } else {
                    sec.classList.add('hidden');
                }
            });

            // 2. Show relevant Columns
            Object.keys(columnContainers).forEach(key => {
                if (columnContainers[key]) {
                    if (key === selectedType) {
                        columnContainers[key].classList.remove('hidden');
                    } else {
                        columnContainers[key].classList.add('hidden');
                    }
                }
            });

            // 3. Populate Data if needed (Mock population)
            if (selectedType === 'contest') populateContestTable();
            if (selectedType === 'problem') populateProblemTable();
            if (selectedType === 'overall') populateOverallTable();
        }

        // --- Data Population Functions ---
        const emptyStateHTML = `
            <tr>
                <td colspan="100%" class="py-12 text-center text-gray-500 dark:text-gray-400">
                    <div class="flex flex-col items-center justify-center">
                        <i class="fas fa-search text-gray-300 dark:text-gray-600 text-4xl mb-3"></i>
                        <p class="mb-2">No records found matching your filters.</p>
                    </div>
                </td>
            </tr>
        `;

        function populateContestTable() {
            const tbody = document.getElementById('contestReportBody');
            const searchInput = document.getElementById('contestSearchInput');
            const statusFilter = document.getElementById('contestStatusFilter');
            const sortFilter = document.getElementById('contestSortFilter');
            const countSpan = document.getElementById('contestVisibleCount');
            if (!tbody) return;

            function render() {
                const term = searchInput ? searchInput.value.toLowerCase() : '';
                const status = statusFilter ? statusFilter.value : '';
                const sort = sortFilter ? sortFilter.value : 'recent';
                let visibleCount = 0;

                let filtered = contestData.slice();

                filtered = filtered.filter(c => {
                    const matchSearch = c.name.toLowerCase().includes(term);
                    const matchStatus = !status || c.status === status;
                    return matchSearch && matchStatus;
                });

                if (sort === 'participants') {
                    filtered.sort((a, b) => b.participants - a.participants);
                } else {
                    filtered.sort((a, b) => b.id - a.id);
                }

                const rows = filtered.map(c => {
                    visibleCount++;
                    let statusClass = 'bg-gray-100 text-gray-800';
                    if (c.status === 'Upcoming') statusClass = 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
                    if (c.status === 'Ongoing') statusClass = 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';

                    return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td class="px-4 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap">${c.name}</td>
                        <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-contestDate whitespace-nowrap">${c.date}</td>
                        <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-participants whitespace-nowrap">${c.participants}</td>
                        <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-avgScore whitespace-nowrap">${c.avgScore}</td>
                        <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-topScorer whitespace-nowrap">${c.topScorer}</td>
                        <td class="px-4 py-3 col-contestStatus whitespace-nowrap"><span class="px-2 py-1 rounded text-xs font-medium ${statusClass}">${c.status}</span></td>
                    </tr>`;
                }).join('');

                if (filtered.length === 0) tbody.innerHTML = emptyStateHTML;
                else tbody.innerHTML = rows;

                if (countSpan) countSpan.innerText = filtered.length;
                updateColumnVisibility('contest');
            }

            if (searchInput) searchInput.oninput = render;
            if (statusFilter) statusFilter.onchange = render;
            if (sortFilter) sortFilter.onchange = render;
            render();
        }

        function populateProblemTable() {
            const tbody = document.getElementById('problemReportBody');
            const searchInput = document.getElementById('problemSearchInput');
            const diffFilter = document.getElementById('problemDifficultyFilter');
            const topicFilter = document.getElementById('problemTopicFilter');
            const sortFilter = document.getElementById('problemSortFilter');
            const countSpan = document.getElementById('problemVisibleCount');
            if (!tbody) return;

            function render() {
                const term = searchInput ? searchInput.value.toLowerCase() : '';
                const diff = diffFilter ? diffFilter.value : '';
                const topic = topicFilter ? topicFilter.value : '';
                const sort = sortFilter ? sortFilter.value : 'recent';

                let filtered = problemData.slice();

                filtered = filtered.filter(p => {
                    const matchSearch = p.title.toLowerCase().includes(term);
                    const matchDiff = !diff || p.difficulty === diff;
                    const matchTopic = !topic || p.topic === topic;
                    return matchSearch && matchDiff && matchTopic;
                });

                if (sort === 'attempts') filtered.sort((a, b) => b.attempts - a.attempts);
                else if (sort === 'success') filtered.sort((a, b) => parseFloat(b.successRate) - parseFloat(a.successRate));
                else filtered.sort((a, b) => b.id - a.id);

                const rows = filtered.map(p => {
                    let diffClass = '';
                    if (p.difficulty === 'Easy') diffClass = 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded text-xs';
                    if (p.difficulty === 'Medium') diffClass = 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1 rounded text-xs';
                    if (p.difficulty === 'Hard') diffClass = 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded text-xs';

                    return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td class="px-4 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap">${p.title}</td>
                         <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-topic whitespace-nowrap">${p.topic}</td>
                        <td class="px-4 py-3 col-difficulty whitespace-nowrap"><span class="${diffClass}">${p.difficulty}</span></td>
                         <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-attempts whitespace-nowrap">${p.attempts}</td>
                         <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-successRate whitespace-nowrap">${p.successRate}</td>
                        <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-avgTime whitespace-nowrap">${p.avgTime}</td>
                    </tr>`;
                }).join('');

                if (filtered.length === 0) tbody.innerHTML = emptyStateHTML;
                else tbody.innerHTML = rows;

                if (countSpan) countSpan.innerText = filtered.length;
                updateColumnVisibility('problem');
            }

            if (searchInput) searchInput.oninput = render;
            if (diffFilter) diffFilter.onchange = render;
            if (topicFilter) topicFilter.onchange = render;
            if (sortFilter) sortFilter.onchange = render;
            render();
        }

        function populateOverallTable() {
            const tbody = document.getElementById('overallReportBody');
            const searchInput = document.getElementById('overallSearchInput');
            const sortFilter = document.getElementById('overallSortFilter');
            const countSpan = document.getElementById('overallVisibleCount');
            if (!tbody) return;

            function render() {
                const term = searchInput ? searchInput.value.toLowerCase() : '';
                const sort = sortFilter ? sortFilter.value : 'rating';

                let filtered = overallData.slice();

                filtered = filtered.filter(d => d.dept && d.dept.toLowerCase().includes(term));

                if (sort === 'participation') filtered.sort((a, b) => parseFloat(b.participation) - parseFloat(a.participation));
                else filtered.sort((a, b) => b.avgRating - a.avgRating);

                const rows = filtered.map(d => {
                    return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td class="px-4 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap">${d.dept}</td>
                        <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-totalStudents whitespace-nowrap">${d.totalStudents}</td>
                        <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-activeStudents whitespace-nowrap">${d.activeStudents}</td>
                        <td class="px-4 py-3 font-semibold text-primary-600 dark:text-primary-400 col-problemsSolved whitespace-nowrap">${d.problemsSolved}</td>
                        <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-contestParticipation whitespace-nowrap">${d.contestParticipation}</td>
                        <td class="px-4 py-3 text-gray-600 dark:text-gray-300 col-avgRating whitespace-nowrap">${d.avgRating}</td>
                    </tr>`;
                }).join('');

                if (filtered.length === 0) tbody.innerHTML = emptyStateHTML;
                else tbody.innerHTML = rows;

                if (countSpan) countSpan.innerText = filtered.length;
                updateColumnVisibility('overall');
            }

            if (searchInput) searchInput.oninput = render;
            if (sortFilter) sortFilter.onchange = render;
            render();
        }

        function updateColumnVisibility(type) {
            const container = columnContainers[type];
            if (!container) return;
            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            const tableId = `${type}ReportTable`;
            // Handle edge case for default student table
            const table = type === 'student' ? document.getElementById('reportTable') : document.getElementById(tableId);

            if (!table) return;

            checkboxes.forEach(cb => {
                const colClass = 'col-' + cb.dataset.column;
                const cells = table.querySelectorAll('.' + colClass);
                cells.forEach(cell => {
                    if (cb.checked) cell.classList.remove('hidden');
                    else cell.classList.add('hidden');
                });
            });
        }

        // Column Selection Logic - Dynamic
        const allColumnCheckboxes = document.querySelectorAll('#columnSelection input[type="checkbox"]');

        allColumnCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', function () {
                // Find which report type this checkbox belongs to
                const container = this.closest('div[id^="cols-"]');
                if (!container) return;

                // Extract type from container id: cols-student -> student
                const type = container.id.replace('cols-', '');

                // Call generic update visibility
                updateColumnVisibility(type);
            });
        });

        // Select All / None Logic
        const selectAllBtn = document.getElementById('selectAllCols');
        const selectNoneBtn = document.getElementById('selectNoneCols');

        function toggleAllColumns(state) {
            const type = reportTypeSelect.value;
            const container = columnContainers[type];
            if (!container) return;

            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = state;
                // Update specific report table
                updateColumnVisibility(type);
            });
        }

        if (selectAllBtn) selectAllBtn.addEventListener('click', () => toggleAllColumns(true));
        if (selectNoneBtn) selectNoneBtn.addEventListener('click', () => toggleAllColumns(false));


        // Export Functionality Placeholder
        function handleReportDownload() {
            const type = reportTypeSelect.value;
            alert(`Downloading ${type} report... (Feature Implementation in progress)`);
        }

        reportTypeSelect.addEventListener('change', initReportUI);

        // Initial call
        initReportUI();
    }


    // --- Support Section Logic ---
            // FAQ logic moved to inline handlers for reliability

    // FAQ Search
    const faqSearch = document.getElementById('faqSearch');
    if (faqSearch) {
        faqSearch.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            document.querySelectorAll('.faq-item').forEach(item => {
                const text = item.innerText.toLowerCase();
                item.style.display = text.includes(term) ? 'block' : 'none';
            });
        });
    }

    // Support Form Handling
    const supportForm = document.getElementById('supportForm');
    if (supportForm) {
        supportForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const btn = this.querySelector('button[type="submit"]');
            const originalText = btn.innerText;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending...';
            btn.disabled = true;
            btn.classList.add('opacity-75', 'cursor-not-allowed');

            setTimeout(() => {
                this.classList.add('hidden');
                document.getElementById('successState').classList.remove('hidden');

                // Reset button for next time
                btn.innerText = originalText;
                btn.disabled = false;
                btn.classList.remove('opacity-75', 'cursor-not-allowed');
                this.reset();
            }, 1200);
        });
    }

    // --- PROBLEM PAGE ACTIONS (ADDED) ---
    const problemForm = typeof problemFormView !== 'undefined' && problemFormView ? problemFormView.querySelector('form') : null;
    const inputTitle = document.getElementById('problem-title-input');
    const selectSubject = document.getElementById('problem-subject-select');
    const selectDifficulty = document.getElementById('problem-difficulty-select');
    let isEditing = false;
    let editingRow = null;

    if (problemForm && typeof problemsListContainer !== 'undefined' && typeof problemFormView !== 'undefined') {
        problemForm.addEventListener('submit', (e) => {
            if (quill) {
                document.getElementById('hidden-description').value = quill.root.innerHTML;
            }

            const formData = new FormData(problemForm);
            const data = Object.fromEntries(formData.entries());

            const url = isEditing ? `/hos/problem/edit/${editingRow.dataset.problemId}` : '/hos/problem/create';
            
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
            .then(res => res.json())
            .then(result => {
                if (result.success) {
                    alert(isEditing ? 'Problem updated successfully!' : 'Problem created successfully!');
                    location.reload(); // Refresh to show new/updated data
                } else {
                    alert('Error: ' + result.message);
                }
            })
            .catch(err => {
                console.error('Submission Error:', err);
                alert('An error occurred during submission.');
            });
        });

        // Input reset on cancel
        const resetHandler = () => {
            isEditing = false;
            editingRow = null;
            problemForm.reset();
            document.querySelector('#problem-form-view h2').innerText = "Create New Problem";
        };
        // Use references from earlier in the scope if available
        if (typeof btnBackToList !== 'undefined' && btnBackToList) btnBackToList.addEventListener('click', resetHandler);
        if (typeof btnCancelProblem !== 'undefined' && btnCancelProblem) btnCancelProblem.addEventListener('click', resetHandler);
    }

    document.addEventListener('click', function (e) {
        // EDIT
        const editBtn = e.target.closest('.edit-problem-btn');
        if (editBtn) {
            const row = editBtn.closest('tr');
            if (row && typeof problemsListContainer !== 'undefined' && typeof problemFormView !== 'undefined') {
                const titleStr = editBtn.dataset.title || "";
                const diffStr = editBtn.dataset.difficulty || "Medium";
                const subjStr = editBtn.dataset.subject || "";
                const descStr = decodeURIComponent(editBtn.dataset.description || "");
                const inputFormatStr = decodeURIComponent(editBtn.dataset.inputFormat || "");
                const outputFormatStr = decodeURIComponent(editBtn.dataset.outputFormat || "");
                const constraintsStr = decodeURIComponent(editBtn.dataset.constraints || "");
                const sampleInputStr = decodeURIComponent(editBtn.dataset.sampleInput || "");
                const sampleOutputStr = decodeURIComponent(editBtn.dataset.sampleOutput || "");
                const hiddenTestsStr = decodeURIComponent(editBtn.dataset.hiddenTestCases || "");

                if (inputTitle) inputTitle.value = titleStr;
                if (selectDifficulty) selectDifficulty.value = diffStr;
                if (selectSubject) selectSubject.value = subjStr;
                if (quill) quill.root.innerHTML = descStr;
                
                // Populate new fields
                const fieldMap = {
                    'problem-input-format': inputFormatStr,
                    'problem-output-format': outputFormatStr,
                    'problem-constraints': constraintsStr,
                    'problem-sample-input': sampleInputStr,
                    'problem-sample-output': sampleOutputStr,
                    'problem-hidden-test-cases': hiddenTestsStr
                };

                for (const [id, val] of Object.entries(fieldMap)) {
                    const el = document.getElementById(id);
                    if (el) el.value = val;
                }

                problemsListContainer.classList.add('hidden');
                problemFormView.classList.remove('hidden');

                isEditing = true;
                editingRow = row;
                editingRow.dataset.problemId = editBtn.dataset.id; // Ensure ID is captured
                document.querySelector('#problem-form-view h2').innerText = "Edit Problem";
            }
        }

        // DELETE
        const delBtn = e.target.closest('.delete-problem-btn');
        if (delBtn) {
            const problemId = delBtn.dataset.id;
            if (confirm('Are you sure you want to delete this problem?')) {
                fetch(`/hos/problem/delete/${problemId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
                .then(res => res.json())
                .then(result => {
                    if (result.success) {
                        delBtn.closest('tr').remove();
                        alert('Problem deleted successfully!');
                    } else {
                        alert('Error: ' + result.message);
                    }
                })
                .catch(err => {
                    console.error('Delete Error:', err);
                    alert('An error occurred while deleting the problem.');
                });
            }
        }

        // REMOVE BOOKMARK (from Bookmarked tab)
        const removeBmBtn = e.target.closest('.remove-bookmark-btn');
        if (removeBmBtn) {
            const row = removeBmBtn.closest('tr');
            const title = row.querySelector('.text-sm').innerText.trim();
            row.remove();

            // Update other tabs
            document.querySelectorAll('.bookmark-btn').forEach(b => {
                const r = b.closest('tr');
                if (r.querySelector('.text-sm') && r.querySelector('.text-sm').innerText.trim() === title) {
                    const i = b.querySelector('i');
                    i.className = 'far fa-bookmark'; // reset
                    i.classList.remove('text-yellow-400');
                }
            });
        }

        // TOGGLE BOOKMARK (Logic extension)
        const bmBtn = e.target.closest('.bookmark-btn');
        if (bmBtn) {
            // Wait for partial existing toggle to finish
            setTimeout(() => {
                const icon = bmBtn.querySelector('i');
                const isBookmarked = icon.classList.contains('fas'); // 'fas' is solid/active
                const row = bmBtn.closest('tr');
                const titleEl = row.querySelector('.text-sm');
                if (!titleEl) return;
                const title = titleEl.innerText.trim();
                const bmTable = document.querySelector('#bookmarked-problems tbody');

                if (isBookmarked) {
                    // Add to table
                    const existing = Array.from(bmTable.querySelectorAll('tr')).find(r => r.querySelector('.text-sm') && r.querySelector('.text-sm').innerText.trim() === title);
                    if (!existing) {
                        const clone = row.cloneNode(true);

                        if (clone.children.length === 4) clone.removeChild(clone.firstElementChild);

                        // Update Action Button
                        const actions = clone.querySelector('td:last-child');
                        actions.innerHTML = `
                            <div class="flex justify-end items-center">
                                <a href="/student/problem/${row.dataset.problemId || ''}" class="bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-md text-xs font-medium transition-colors">Solve</a>
                                <button class="text-red-500 hover:text-red-700 transition-colors flex items-center gap-1 text-xs font-medium bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded ml-2 remove-bookmark-btn" title="Remove Bookmark">
                                    <i class="fas fa-times"></i> Remove
                                </button>
                            </div>
                         `;
                        bmTable.appendChild(clone);
                    }
                } else {
                    // Remove from table
                    const existing = Array.from(bmTable.querySelectorAll('tr')).find(r => r.querySelector('.text-sm') && r.querySelector('.text-sm').innerText.trim() === title);
                    if (existing) existing.remove();
                }
            }, 50);
        }
    });

});
