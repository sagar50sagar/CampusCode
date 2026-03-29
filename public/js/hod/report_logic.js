document.addEventListener("DOMContentLoaded", () => {
    // --- SHELL LOGIC (Sidebar, Theme, Profile) ---
    const sidebar = document.getElementById('mainSidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const toggleIcon = toggleBtn ? toggleBtn.querySelector('i') : null;
    const sidebarLogoText = document.getElementById('sidebarLogoText');
    const headerLogoText = document.getElementById('headerLogoText');

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            if (sidebar.classList.contains('collapsed')) {
                sidebar.classList.replace('w-64', 'w-20');
                if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
                if (sidebarLogoText) { sidebarLogoText.style.opacity = '0'; sidebarLogoText.style.width = '0px'; }
                if (headerLogoText) { headerLogoText.classList.remove('hidden'); setTimeout(() => { headerLogoText.classList.remove('opacity-0', '-translate-x-2'); }, 50); }
            } else {
                sidebar.classList.replace('w-20', 'w-64');
                if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
                if (sidebarLogoText) { sidebarLogoText.style.opacity = '1'; sidebarLogoText.style.width = 'auto'; }
                if (headerLogoText) { headerLogoText.classList.add('opacity-0', '-translate-x-2'); setTimeout(() => { headerLogoText.classList.add('hidden'); }, 300); }
            }
        });
    }

    const themeBtn = document.getElementById('themeToggleBtn');
    const themeIcon = themeBtn ? themeBtn.querySelector('i') : null;
    const html = document.documentElement;

    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            html.classList.toggle('dark');
            const isDarkNow = html.classList.contains('dark');
            if (themeIcon) {
                if (isDarkNow) themeIcon.classList.replace('fa-moon', 'fa-sun');
                else themeIcon.classList.replace('fa-sun', 'fa-moon');
            }
            try { localStorage.theme = isDarkNow ? 'dark' : 'light'; } catch (e) { }
        });
    }

    const notifBtn = document.getElementById('notificationBtn');
    const notifDropdown = document.getElementById('notificationDropdown');
    if (notifBtn && notifDropdown) {
        notifBtn.addEventListener('click', (e) => { e.stopPropagation(); notifDropdown.classList.toggle('hidden'); });
        document.addEventListener('click', (e) => {
            if (!notifDropdown.contains(e.target) && !notifBtn.contains(e.target)) notifDropdown.classList.add('hidden');
        });
    }

    const overlay = document.getElementById("profileOverlay");
    const openProfile = () => overlay?.classList.remove("hidden");
    const closeProfile = () => overlay?.classList.add("hidden");

    document.getElementById("headerProfileBtn")?.addEventListener("click", openProfile);
    document.getElementById("closeProfileOverlay")?.addEventListener("click", closeProfile);
    overlay?.addEventListener("click", (e) => { if (e.target === overlay) closeProfile(); });

    document.getElementById('btnLogout')?.addEventListener('click', () => {
        window.location.href = '/auth/logout';
    });


    // --- MOCK DATA GENERATORS ---
    const getFacultyData = () => {
        return [
            { id: "FAC-001", name: "Dr. John Doe", dept: "CSE", joined: "2015-08-01", status: "Active", rating: 4.8 },
            { id: "FAC-002", name: "Prof. Sarah Smith", dept: "ECE", joined: "2018-01-15", status: "Active", rating: 4.5 },
            { id: "FAC-003", name: "Dr. Emily Chen", dept: "CSE", joined: "2019-11-20", status: "On Leave", rating: 4.9 },
            { id: "FAC-004", name: "Mr. Michael Brown", dept: "ME", joined: "2020-05-10", status: "Active", rating: 4.2 },
            { id: "FAC-005", name: "Ms. Lisa Wong", dept: "CSE", joined: "2021-09-01", status: "Active", rating: 4.6 }
        ];
    };

    const getStudentData = () => {
        return [
            { id: "STU-1001", name: "Alice Johnson", dept: "CSE", year: "3", section: "A", attendance: 92, gpa: 9.1 },
            { id: "STU-1002", name: "Bob Williams", dept: "ECE", year: "2", section: "B", attendance: 85, gpa: 8.5 },
            { id: "STU-1003", name: "Charlie Davis", dept: "CSE", year: "4", section: "A", attendance: 78, gpa: 7.9 },
            { id: "STU-1004", name: "Diana Evans", dept: "ME", year: "1", section: "C", attendance: 95, gpa: 8.8 },
            { id: "STU-1005", name: "Ethan Frank", dept: "CSE", year: "3", section: "B", attendance: 88, gpa: 8.2 }
        ];
    };

    const getContestData = () => {
        return [
            { id: "CON-501", title: "Weekly Coding Challenge #45", date: "2023-10-15", participants: 120, winner: "Alice Johnson" },
            { id: "CON-502", title: "Freshers Hackathon", date: "2023-11-01", participants: 350, winner: "Diana Evans" },
            { id: "CON-503", title: "DSA Sprint", date: "2023-11-20", participants: 85, winner: "Ethan Frank" }
        ];
    };

    const getProblemData = () => {
        return [
            { id: "P-101", title: "Two Sum", difficulty: "Easy", tags: "Array, HashMap", solved: 1540 },
            { id: "P-102", title: "LRU Cache", difficulty: "Medium", tags: "LinkList, HashMap", solved: 850 },
            { id: "P-103", title: "Median of Two Sorted Arrays", difficulty: "Hard", tags: "Binary Search", solved: 420 },
            { id: "P-104", title: "Valid Parentheses", difficulty: "Easy", tags: "Stack", solved: 2100 }
        ];
    };

    // --- SHARED UI LOGIC ---
    const updateDate = () => {
        const d = document.getElementById('currentDate');
        if (d) {
            const now = new Date();
            d.innerText = now.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        }
    };
    updateDate();

    // --- MAIN REPORT UI SWITCHER ---
    window.initReportUI = () => {
        const type = document.getElementById('reportType').value;
        const title = document.getElementById('previewTitle');
        const container = document.getElementById('previewTableContainer');
        const filterContainer = document.getElementById('filterContainer');
        const badge = document.getElementById('formatBadge');

        badge.innerText = `${type.toUpperCase()} REPORT`;

        // Update Filters UI based on Type
        let filterHTML = '';
        if (type === 'Contests') {
            title.innerText = "Contest Analytics Report";
            filterHTML = `
                <select class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"><option>All Subjects</option><option>DSA</option></select>
                <div class="flex gap-2"><input type="date" class="w-1/2 border rounded-lg p-2 text-sm"><input type="date" class="w-1/2 border rounded-lg p-2 text-sm"></div>
            `;
        } else if (type === 'Problems') {
            title.innerText = "Problem Bank Inventory";
            filterHTML = `
                <select class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"><option>All Difficulties</option><option>Easy</option><option>Medium</option><option>Hard</option></select>
                <select class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"><option>All Tags</option><option>Arrays</option><option>DP</option></select>
            `;
        } else if (type === 'Faculty') {
            title.innerText = "Faculty Performance Report";
            filterHTML = `
                <select class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"><option>All Depts</option><option>CSE</option><option>ECE</option></select>
                <select class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"><option>Active</option><option>On Leave</option></select>
            `;
        } else if (type === 'Students') {
            title.innerText = "Student Attendance Report";
            filterHTML = `
                <select class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"><option>All Years</option><option>1st Year</option><option>2nd Year</option></select>
                <select class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white"><option>All Sections</option><option>A</option><option>B</option></select>
            `;
        }

        filterContainer.innerHTML = filterHTML;

        // Render Preview Table (First 3-5 rows)
        renderMainPreviewTable(type, container);
    };

    const renderMainPreviewTable = (type, container) => {
        let headers = [];
        let data = [];

        if (type === 'Faculty') {
            headers = ["ID", "Name", "Dept", "Rating"];
            data = getFacultyData().slice(0, 3).map(f => [f.id, f.name, f.dept, f.rating]);
        } else if (type === 'Students') {
            headers = ["ID", "Name", "Year", "Attendance"];
            data = getStudentData().slice(0, 3).map(s => [s.id, s.name, s.year, s.attendance + "%"]);
        } else if (type === 'Contests') {
            headers = ["Title", "Date", "Participants"];
            data = getContestData().slice(0, 3).map(c => [c.title, c.date, c.participants]);
        } else {
            headers = ["Title", "Difficulty", "Solved"];
            data = getProblemData().slice(0, 3).map(p => [p.title, p.difficulty, p.solved]);
        }

        let html = `<table class="w-full text-left text-sm"><thead class="border-b-2 border-gray-100"><tr>`;
        headers.forEach(h => html += `<th class="py-2 text-xs font-bold text-gray-500 uppercase">${h}</th>`);
        html += `</tr></thead><tbody class="divide-y divide-gray-50">`;
        data.forEach(row => {
            html += `<tr>`;
            row.forEach(cell => html += `<td class="py-3 text-gray-700 font-medium">${cell}</td>`);
            html += `</tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
    };

    // Initialize UI on load
    window.initReportUI();


    // --- DOWNLOAD HANDLER ---
    window.handleReportDownload = () => {
        const type = document.getElementById('reportType').value;

        if (type === 'Faculty') {
            document.getElementById('exportPreviewModal').classList.remove('hidden');
            renderExportModal('Faculty');
        } else if (type === 'Students') {
            document.getElementById('studentExportPreviewModal').classList.remove('hidden');
            renderExportModal('Students');
        } else if (type === 'Contests') {
            document.getElementById('exportContestModal').classList.remove('hidden');
            renderExportModal('Contests');
        } else if (type === 'Problems') {
            document.getElementById('exportProblemsModal').classList.remove('hidden');
            renderExportModal('Problems');
        } else {
            alert(`Report download for ${type} is coming soon!`);
        }
    };


    // --- EXPORT MODAL LOGIC (Generic) ---
    // This function populates the Tables inside the modals
    const renderExportModal = (type) => {
        let data = [];
        let headers = [];
        let tbodyId = '';
        let theadRowId = '';

        if (type === 'Faculty') {
            data = getFacultyData();
            headers = ["ID", "Name", "Dept", "Joined", "Status", "Rating"];
            tbodyId = 'exportTableBody';
            theadRowId = 'exportTableHeadRow';
        } else if (type === 'Students') {
            data = getStudentData();
            headers = ["ID", "Name", "Dept", "Year", "Section", "Attendance", "GPA"];
            tbodyId = 'studentExportTableBody';
            theadRowId = 'studentExportTableHeadRow';
        } else if (type === 'Contests') {
            data = getContestData();
            headers = ["ID", "Title", "Date", "Participants", "Winner"];
            tbodyId = 'contestTableBody';
            theadRowId = 'contestTableHeadRow';
        } else if (type === 'Problems') {
            data = getProblemData();
            headers = ["ID", "Title", "Difficulty", "Tags", "Solved"];
            tbodyId = 'probTableBody';
            theadRowId = 'probTableHeadRow';
        }

        // Render Headers
        const thead = document.getElementById(theadRowId);
        if (thead) {
            thead.innerHTML = headers.map(h => `<th class="px-6 py-3">${h}</th>`).join('');
        }

        // Render Body
        const tbody = document.getElementById(tbodyId);
        if (tbody) {
            tbody.innerHTML = data.map(row => {
                // Convert object to array values in consistent order
                let values = headers.map(h => {
                    const key = h.toLowerCase();
                    if (key === 'rating') return row.rating;
                    if (key === 'id') return row.id;
                    if (key === 'name') return row.name;
                    if (key === 'dept') return row.dept;
                    if (key === 'year') return row.year;
                    if (key === 'section') return row.section;
                    if (key === 'joined') return row.joined;
                    if (key === 'status') return row.status;
                    if (key === 'attendance') return row.attendance + '%';
                    if (key === 'gpa') return row.gpa;
                    if (key === 'title') return row.title;
                    if (key === 'date') return row.date;
                    if (key === 'participants') return row.participants;
                    if (key === 'winner') return row.winner;
                    if (key === 'difficulty') return row.difficulty;
                    if (key === 'tags') return row.tags;
                    if (key === 'solved') return row.solved;
                    return '';
                });
                return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    ${values.map(v => `<td class="px-6 py-4 whitespace-nowrap text-gray-700 dark:text-gray-300 font-medium">${v}</td>`).join('')}
               </tr>`;
            }).join('');
        }
    };


    // --- GENERIC CLOSE MODAL LOGIC ---
    const closeModals = () => {
        document.querySelectorAll('[id$="Modal"]').forEach(m => m.classList.add('hidden'));
    };

    // Wire up Close Buttons
    document.getElementById('closeExportModal')?.addEventListener('click', closeModals);
    document.getElementById('closeStudentExportModal')?.addEventListener('click', closeModals);
    document.getElementById('closeContestModal')?.addEventListener('click', closeModals);
    document.getElementById('closeProblemsModal')?.addEventListener('click', closeModals);


    // --- EXPORT FUNCTIONALITY (SheetJS & jsPDF) ---
    const exportFile = (type, format) => {
        const reportType = document.getElementById('reportType').value;
        const filename = `${reportType}_Report_${new Date().toISOString().slice(0, 10)}`;

        if (format === 'excel') {
            alert(`Generating Excel for ${reportType}...`);
            // In a real scenario, we would parse the table ID
            // For now, we mock success
            /* 
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.table_to_sheet(document.getElementById('exportPreviewTable')); // dynamic ID needed
            XLSX.utils.book_append_sheet(wb, ws, "Report");
            XLSX.writeFile(wb, filename + ".xlsx");
            */
            setTimeout(() => alert("Download Complete: " + filename + ".xlsx"), 500);

        } else if (format === 'pdf') {
            alert(`Generating PDF for ${reportType}...`);
            /*
            const element = document.getElementById('exportPreviewModal'); // dynamic ID
            html2pdf().from(element).save(filename + ".pdf");
            */
            setTimeout(() => alert("Download Complete: " + filename + ".pdf"), 500);
        }
        closeModals();
    };

    // Wire up Export Buttons (Faculty)
    document.getElementById('btnFinalDownloadExcel')?.addEventListener('click', () => exportFile('Faculty', 'excel'));
    document.getElementById('btnFinalDownloadPDF')?.addEventListener('click', () => exportFile('Faculty', 'pdf'));

    // Wire up Export Buttons (Student)
    document.getElementById('btnStudentDownloadExcel')?.addEventListener('click', () => exportFile('Student', 'excel'));
    document.getElementById('btnStudentDownloadPDF')?.addEventListener('click', () => exportFile('Student', 'pdf'));

    // Wire up Export Buttons (Contest) - Add IDs to HTML first or reuse logic if IDs match
    // For now assuming existing IDs in modals
    document.getElementById('btnDownloadContestPDF')?.addEventListener('click', () => exportFile('Contest', 'pdf'));
    document.getElementById('btnDownloadProblemsPDF')?.addEventListener('click', () => exportFile('Problems', 'pdf'));

});
