document.addEventListener("DOMContentLoaded", () => {
    const reportData = window.__HOD_REPORT_DATA || {};
    const datasets = {
        Contests: reportData.contests || [],
        Problems: reportData.problems || [],
        Progress: reportData.progress || [],
        Faculty: reportData.faculty || [],
        Students: reportData.students || []
    };
    const filtersMeta = reportData.filters || {};

    const typeConfig = {
        Contests: {
            title: "Contest Analytics Report",
            badge: "PDF REPORT",
            columns: [
                { key: "id", label: "ID" },
                { key: "title", label: "Title" },
                { key: "contestClass", label: "Class" },
                { key: "subject", label: "Subject" },
                { key: "participants", label: "Participants" },
                { key: "status", label: "Status" },
                { key: "startDate", label: "Start" },
                { key: "endDate", label: "End" }
            ]
        },
        Problems: {
            title: "Problem Bank Inventory",
            badge: "PDF REPORT",
            columns: [
                { key: "id", label: "ID" },
                { key: "title", label: "Title" },
                { key: "difficulty", label: "Difficulty" },
                { key: "subject", label: "Subject" },
                { key: "status", label: "Status" },
                { key: "totalSubmissions", label: "Submissions" },
                { key: "acceptedSubmissions", label: "Accepted" },
                { key: "acceptanceRate", label: "Accept %" }
            ]
        },
        Progress: {
            title: "Progress Performance Report",
            badge: "XLSX REPORT",
            columns: [
                { key: "month", label: "Month" },
                { key: "totalSubmissions", label: "Submissions" },
                { key: "acceptedSubmissions", label: "Accepted" },
                { key: "acceptanceRate", label: "Accept %" }
            ]
        },
        Faculty: {
            title: "Faculty Performance Report",
            badge: "XLSX REPORT",
            columns: [
                { key: "facultyId", label: "Faculty ID" },
                { key: "name", label: "Name" },
                { key: "email", label: "Email" },
                { key: "department", label: "Department" },
                { key: "program", label: "Program" },
                { key: "role", label: "Role" },
                { key: "status", label: "Status" },
                { key: "assignedCount", label: "Assigned Load" }
            ]
        },
        Students: {
            title: "Student Performance Report",
            badge: "XLSX REPORT",
            columns: [
                { key: "studentId", label: "Student ID" },
                { key: "name", label: "Name" },
                { key: "email", label: "Email" },
                { key: "department", label: "Department" },
                { key: "year", label: "Year" },
                { key: "section", label: "Section" },
                { key: "points", label: "XP" },
                { key: "solvedCount", label: "Solved" },
                { key: "rank", label: "Rank" },
                { key: "submissions", label: "Submissions" }
            ]
        }
    };

    const getEl = (id) => document.getElementById(id);
    const setCurrentDate = () => {
        const el = getEl("currentDate");
        if (!el) return;
        const generatedAt = reportData.generatedAt ? new Date(reportData.generatedAt) : new Date();
        el.textContent = generatedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    };

    const renderReportMeta = () => {
        const generatedAt = reportData.generatedAt ? new Date(reportData.generatedAt) : new Date();
        const refEl = getEl("reportRef");
        if (refEl) {
            const ref = `CC-${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, "0")}${String(generatedAt.getDate()).padStart(2, "0")}`;
            refEl.textContent = ref;
        }

        const summary = reportData.summary || {};
        const scope = reportData.scope || {};
        const notifTitle1 = getEl("notifTitle1");
        const notifBody1 = getEl("notifBody1");
        const notifTitle2 = getEl("notifTitle2");
        const notifBody2 = getEl("notifBody2");

        if (notifTitle1) notifTitle1.textContent = "Report Summary";
        if (notifBody1) {
            notifBody1.textContent = `${toNumber(summary.problemCount)} problems, ${toNumber(summary.contestCount)} contests, ${toNumber(summary.studentCount)} students tracked.`;
        }

        if (notifTitle2) notifTitle2.textContent = "Department Scope";
        if (notifBody2) {
            const branch = scope.branch || "N/A";
            const program = scope.program || "N/A";
            notifBody2.textContent = `${branch} • ${program} • Acceptance ${toNumber(summary.acceptanceRate).toFixed(2)}%`;
        }
    };

    const normalize = (v) => String(v || "").toLowerCase();
    const toNumber = (v) => Number(v || 0);
    const pick = (row, key) => (row && row[key] !== undefined && row[key] !== null ? row[key] : "-");

    const renderSidebarThemeShell = () => {
        const sidebar = getEl("mainSidebar");
        const toggleBtn = getEl("sidebarToggleBtn");
        const toggleIcon = toggleBtn ? toggleBtn.querySelector("i") : null;
        const sidebarLogoText = getEl("sidebarLogoText");
        const headerLogoText = getEl("headerLogoText");
        const themeBtn = getEl("themeToggleBtn");
        const themeIcon = themeBtn ? themeBtn.querySelector("i") : null;
        const notifBtn = getEl("notificationBtn");
        const notifDropdown = getEl("notificationDropdown");
        const overlay = getEl("profileOverlay");

        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener("click", () => {
                sidebar.classList.toggle("collapsed");
                if (sidebar.classList.contains("collapsed")) {
                    sidebar.classList.replace("w-64", "w-20");
                    if (toggleIcon) toggleIcon.style.transform = "rotate(180deg)";
                    if (sidebarLogoText) { sidebarLogoText.style.opacity = "0"; sidebarLogoText.style.width = "0px"; }
                    if (headerLogoText) {
                        headerLogoText.classList.remove("hidden");
                        setTimeout(() => headerLogoText.classList.remove("opacity-0", "-translate-x-2"), 50);
                    }
                } else {
                    sidebar.classList.replace("w-20", "w-64");
                    if (toggleIcon) toggleIcon.style.transform = "rotate(0deg)";
                    if (sidebarLogoText) { sidebarLogoText.style.opacity = "1"; sidebarLogoText.style.width = "auto"; }
                    if (headerLogoText) {
                        headerLogoText.classList.add("opacity-0", "-translate-x-2");
                        setTimeout(() => headerLogoText.classList.add("hidden"), 300);
                    }
                }
            });
        }

        if (themeBtn) {
            themeBtn.addEventListener("click", () => {
                document.documentElement.classList.toggle("dark");
                const isDark = document.documentElement.classList.contains("dark");
                if (themeIcon) {
                    if (isDark) themeIcon.classList.replace("fa-moon", "fa-sun");
                    else themeIcon.classList.replace("fa-sun", "fa-moon");
                }
                try { localStorage.theme = isDark ? "dark" : "light"; } catch (_) { }
            });
        }

        if (notifBtn && notifDropdown) {
            notifBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                notifDropdown.classList.toggle("hidden");
            });
            document.addEventListener("click", (e) => {
                if (!notifDropdown.contains(e.target) && !notifBtn.contains(e.target)) {
                    notifDropdown.classList.add("hidden");
                }
            });
        }

        const openProfile = () => overlay && overlay.classList.remove("hidden");
        const closeProfile = () => overlay && overlay.classList.add("hidden");
        getEl("headerProfileBtn")?.addEventListener("click", openProfile);
        getEl("closeProfileOverlay")?.addEventListener("click", closeProfile);
        overlay?.addEventListener("click", (e) => { if (e.target === overlay) closeProfile(); });

        const logout = () => { window.location.href = "/auth/logout"; };
        getEl("logoutBtn")?.addEventListener("click", logout);
        getEl("btnLogout")?.addEventListener("click", logout);
    };

    const getMainFilteredRows = (type) => {
        let rows = (datasets[type] || []).slice();
        const search = normalize(getEl("mainFilterSearch")?.value);
        const f1 = getEl("mainFilter1")?.value || "all";
        const f2 = getEl("mainFilter2")?.value || "all";

        if (search) {
            rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(search));
        }

        if (type === "Contests") {
            if (f1 !== "all") rows = rows.filter((r) => normalize(r.subject) === normalize(f1));
            if (f2 !== "all") rows = rows.filter((r) => normalize(r.status) === normalize(f2));
        } else if (type === "Problems") {
            if (f1 !== "all") rows = rows.filter((r) => normalize(r.difficulty) === normalize(f1));
            if (f2 !== "all") rows = rows.filter((r) => normalize(r.status) === normalize(f2));
        } else if (type === "Faculty") {
            if (f1 !== "all") rows = rows.filter((r) => normalize(r.department) === normalize(f1));
            if (f2 !== "all") rows = rows.filter((r) => normalize(r.role) === normalize(f2));
        } else if (type === "Students") {
            if (f1 !== "all") rows = rows.filter((r) => normalize(r.year) === normalize(f1));
            if (f2 !== "all") rows = rows.filter((r) => normalize(r.section) === normalize(f2));
        }

        return rows;
    };

    const renderMainFilters = (type) => {
        const container = getEl("filterContainer");
        if (!container) return;

        const mkOptions = (list, labelAll) => [`<option value="all">${labelAll}</option>`]
            .concat((list || []).map((x) => `<option value="${String(x).replace(/"/g, "&quot;")}">${x}</option>`))
            .join("");

        let html = `
            <div class="relative">
                <i class="fas fa-search absolute left-3 top-3 text-gray-400 text-xs"></i>
                <input id="mainFilterSearch" type="text" class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 pl-8 text-sm bg-white dark:bg-gray-700 dark:text-white" placeholder="Search..." />
            </div>
        `;

        if (type === "Contests") {
            html += `
                <select id="mainFilter1" class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:text-white">${mkOptions(filtersMeta.subjects, "All Subjects")}</select>
                <select id="mainFilter2" class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:text-white">${mkOptions(filtersMeta.statuses, "All Status")}</select>
            `;
        } else if (type === "Problems") {
            html += `
                <select id="mainFilter1" class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:text-white">${mkOptions(filtersMeta.difficulties, "All Difficulty")}</select>
                <select id="mainFilter2" class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:text-white">${mkOptions(filtersMeta.statuses, "All Status")}</select>
            `;
        } else if (type === "Faculty") {
            html += `
                <select id="mainFilter1" class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:text-white">${mkOptions(filtersMeta.departments, "All Departments")}</select>
                <select id="mainFilter2" class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:text-white">
                    <option value="all">All Roles</option>
                    <option value="FACULTY">FACULTY</option>
                    <option value="HOS">HOS</option>
                </select>
            `;
        } else if (type === "Students") {
            html += `
                <select id="mainFilter1" class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:text-white">${mkOptions(filtersMeta.years, "All Years")}</select>
                <select id="mainFilter2" class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:text-white">${mkOptions(filtersMeta.sections, "All Sections")}</select>
            `;
        } else {
            html += `<p class="text-xs text-gray-500 italic">Progress uses timeline-based data (last months).</p>`;
        }

        container.innerHTML = html;
        ["mainFilterSearch", "mainFilter1", "mainFilter2"].forEach((id) => {
            getEl(id)?.addEventListener("input", () => window.initReportUI());
            getEl(id)?.addEventListener("change", () => window.initReportUI());
        });
    };

    const renderPreviewTable = (type, rows) => {
        const container = getEl("previewTableContainer");
        if (!container) return;
        const cols = typeConfig[type].columns;
        const previewRows = rows.slice(0, 8);

        let html = `<table class="w-full text-left text-sm"><thead class="border-b-2 border-gray-100"><tr>`;
        cols.slice(0, 6).forEach((c) => { html += `<th class="py-2 text-xs font-bold text-gray-500 uppercase">${c.label}</th>`; });
        html += `</tr></thead><tbody class="divide-y divide-gray-50">`;
        previewRows.forEach((row) => {
            html += `<tr>`;
            cols.slice(0, 6).forEach((c) => { html += `<td class="py-3 text-gray-700 font-medium">${pick(row, c.key)}</td>`; });
            html += `</tr>`;
        });
        if (!previewRows.length) {
            html += `<tr><td colspan="6" class="py-6 text-center text-gray-400 italic">No data available</td></tr>`;
        }
        html += `</tbody></table>`;
        container.innerHTML = html;
    };

    window.initReportUI = () => {
        const type = getEl("reportType")?.value || "Contests";
        const title = getEl("previewTitle");
        const badge = getEl("formatBadge");
        const actionBtn = getEl("actionBtn");

        if (!typeConfig[type]) return;
        if (title) title.textContent = typeConfig[type].title;
        if (badge) badge.textContent = typeConfig[type].badge;
        if (actionBtn) {
            actionBtn.innerHTML = `<i class="fas fa-download"></i> Download ${typeConfig[type].badge.includes("PDF") ? "PDF" : "Excel"}`;
        }

        renderMainFilters(type);
        const filtered = getMainFilteredRows(type);
        renderPreviewTable(type, filtered);
    };

    const modalState = {
        Faculty: { selected: [], filteredRows: [] },
        Students: { selected: [], filteredRows: [] },
        Contests: { selected: [], filteredRows: [] },
        Problems: { selected: [], filteredRows: [] }
    };

    const modalMap = {
        Faculty: {
            modalId: "exportPreviewModal",
            selectionListId: "columnSelectionList",
            headId: "exportTableHeadRow",
            bodyId: "exportTableBody",
            countId: "previewCount",
            searchId: "exportSearchInput",
            sortId: "exportSortSelect"
        },
        Students: {
            modalId: "studentExportPreviewModal",
            selectionListId: "studentColumnSelectionList",
            headId: "studentExportTableHeadRow",
            bodyId: "studentExportTableBody",
            countId: "studentPreviewCount",
            searchId: "studentExportSearchInput",
            sortId: "studentExportSortSelect"
        },
        Contests: {
            modalId: "exportContestModal",
            selectionListId: "contestColumnSelectionList",
            headId: "contestTableHeadRow",
            bodyId: "contestTableBody",
            countId: "contestPreviewCount",
            searchId: "contestSearchInput",
            sortId: "contestSortSelect"
        },
        Problems: {
            modalId: "exportProblemsModal",
            selectionListId: "probColumnSelectionList",
            headId: "probTableHeadRow",
            bodyId: "probTableBody",
            countId: "probPreviewCount",
            searchId: "probSearchInput",
            sortId: "probSortSelect"
        }
    };

    const openModalFor = (type) => {
        Object.keys(modalMap).forEach((k) => getEl(modalMap[k].modalId)?.classList.add("hidden"));
        const map = modalMap[type];
        if (!map) return;
        getEl(map.modalId)?.classList.remove("hidden");
        modalState[type].selected = typeConfig[type].columns.map((c) => c.key);
        renderModalSelection(type);
        renderModalTable(type);
    };

    const closeAllModals = () => {
        Object.values(modalMap).forEach((m) => getEl(m.modalId)?.classList.add("hidden"));
    };

    const renderModalSelection = (type) => {
        const map = modalMap[type];
        const holder = getEl(map.selectionListId);
        if (!holder) return;
        holder.innerHTML = typeConfig[type].columns.map((c) => `
            <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" data-type="${type}" data-col="${c.key}" ${modalState[type].selected.includes(c.key) ? "checked" : ""} class="rounded border-gray-300 text-primary-600 focus:ring-primary-500">
                <span>${c.label}</span>
            </label>
        `).join("");
        holder.querySelectorAll("input[type='checkbox']").forEach((cb) => {
            cb.addEventListener("change", (e) => {
                const col = e.target.getAttribute("data-col");
                if (e.target.checked) {
                    if (!modalState[type].selected.includes(col)) modalState[type].selected.push(col);
                } else {
                    modalState[type].selected = modalState[type].selected.filter((x) => x !== col);
                }
                renderModalTable(type);
            });
        });
    };

    const getModalFilteredRows = (type) => {
        let rows = (datasets[type] || []).slice();
        const map = modalMap[type];
        const search = normalize(getEl(map.searchId)?.value);
        if (search) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(search));

        if (type === "Students") {
            const year = getEl("studentExportFilterYear")?.value || "all";
            const sec = getEl("studentExportFilterSection")?.value || "all";
            const dept = getEl("studentExportFilterDept")?.value || "all";
            if (year !== "all") rows = rows.filter((r) => normalize(r.year) === normalize(year));
            if (sec !== "all") rows = rows.filter((r) => normalize(r.section) === normalize(sec));
            if (dept !== "all") rows = rows.filter((r) => normalize(r.department) === normalize(dept));
        } else if (type === "Contests") {
            const subject = getEl("contestFilterSubject")?.value || "all";
            const start = getEl("contestStartDate")?.value || "";
            const end = getEl("contestEndDate")?.value || "";
            if (subject !== "all") rows = rows.filter((r) => normalize(r.subject) === normalize(subject));
            if (start) rows = rows.filter((r) => String(r.startDate || r.createdAt || "") >= start);
            if (end) rows = rows.filter((r) => String(r.endDate || r.startDate || r.createdAt || "") <= end);
        } else if (type === "Problems") {
            const diff = getEl("probFilterDifficulty")?.value || "all";
            if (diff !== "all") rows = rows.filter((r) => normalize(r.difficulty) === normalize(diff));
        }

        const sort = getEl(map.sortId)?.value || "";
        if (sort) {
            rows.sort((a, b) => {
                if (sort === "name_asc") return String(a.name || "").localeCompare(String(b.name || ""));
                if (sort === "name_desc") return String(b.name || "").localeCompare(String(a.name || ""));
                if (sort === "rank_high") return toNumber(b.rank) - toNumber(a.rank);
                if (sort === "date_new") return String(b.startDate || b.createdAt || "").localeCompare(String(a.startDate || a.createdAt || ""));
                if (sort === "date_old") return String(a.startDate || a.createdAt || "").localeCompare(String(b.startDate || b.createdAt || ""));
                if (sort === "title_asc") return String(a.title || "").localeCompare(String(b.title || ""));
                if (sort === "participation_desc") return toNumber(b.participants) - toNumber(a.participants);
                if (sort === "difficulty_asc") return String(a.difficulty || "").localeCompare(String(b.difficulty || ""));
                if (sort === "difficulty_desc") return String(b.difficulty || "").localeCompare(String(a.difficulty || ""));
                return 0;
            });
        }
        return rows;
    };

    const renderModalTable = (type) => {
        const map = modalMap[type];
        const head = getEl(map.headId);
        const body = getEl(map.bodyId);
        if (!head || !body) return;

        const selectedCols = typeConfig[type].columns.filter((c) => modalState[type].selected.includes(c.key));
        const rows = getModalFilteredRows(type);
        modalState[type].filteredRows = rows;

        head.innerHTML = selectedCols.map((c) => `<th class="px-6 py-3">${c.label}</th>`).join("");
        body.innerHTML = rows.slice(0, 500).map((row) => `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                ${selectedCols.map((c) => `<td class="px-6 py-4 whitespace-nowrap text-gray-700 dark:text-gray-300 font-medium">${pick(row, c.key)}</td>`).join("")}
            </tr>
        `).join("");

        const count = getEl(map.countId);
        if (count) count.textContent = String(rows.length);
    };

    const exportRows = (type, format) => {
        const cols = typeConfig[type].columns.filter((c) => modalState[type].selected.includes(c.key));
        const rows = modalState[type].filteredRows || [];
        const fileBase = `HOD_${type}_Report_${new Date().toISOString().slice(0, 10)}`;

        if (format === "excel") {
            const exportData = rows.map((r) => {
                const o = {};
                cols.forEach((c) => { o[c.label] = pick(r, c.key); });
                return o;
            });
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(exportData);
            XLSX.utils.book_append_sheet(wb, ws, "Report");
            XLSX.writeFile(wb, `${fileBase}.xlsx`);
            return;
        }

        if (format === "pdf" && window.jspdf && window.jspdf.jsPDF) {
            const doc = new window.jspdf.jsPDF("l", "pt", "a4");
            doc.setFontSize(14);
            doc.text(`${type} Report`, 40, 36);
            doc.setFontSize(10);
            doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 54);
            doc.autoTable({
                startY: 70,
                head: [cols.map((c) => c.label)],
                body: rows.map((r) => cols.map((c) => pick(r, c.key)))
            });
            doc.save(`${fileBase}.pdf`);
            return;
        }

        // Fallback print
        const w = window.open("", "_blank");
        if (!w) return;
        w.document.write("<html><head><title>Report</title></head><body>");
        w.document.write(`<h2>${type} Report</h2>`);
        w.document.write("<table border='1' cellspacing='0' cellpadding='6'><tr>");
        cols.forEach((c) => w.document.write(`<th>${c.label}</th>`));
        w.document.write("</tr>");
        rows.forEach((r) => {
            w.document.write("<tr>");
            cols.forEach((c) => w.document.write(`<td>${pick(r, c.key)}</td>`));
            w.document.write("</tr>");
        });
        w.document.write("</table></body></html>");
        w.document.close();
        w.print();
    };

    // Main action button (open type-specific export modal)
    const exportMainDirect = (type) => {
        const cols = typeConfig[type].columns;
        const rows = getMainFilteredRows(type);
        const fileBase = `HOD_${type}_Report_${new Date().toISOString().slice(0, 10)}`;
        const exportData = rows.map((r) => {
            const o = {};
            cols.forEach((c) => { o[c.label] = pick(r, c.key); });
            return o;
        });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        XLSX.utils.book_append_sheet(wb, ws, "Report");
        XLSX.writeFile(wb, `${fileBase}.xlsx`);
    };

    window.handleReportDownload = () => {
        const type = getEl("reportType")?.value || "Contests";
        if (type === "Progress") {
            exportMainDirect(type);
            return;
        }
        if (!modalMap[type]) return;
        openModalFor(type);
    };

    // Select-all hooks
    getEl("selectAllColumns")?.addEventListener("click", () => {
        modalState.Faculty.selected = typeConfig.Faculty.columns.map((c) => c.key);
        renderModalSelection("Faculty");
        renderModalTable("Faculty");
    });
    getEl("selectAllStudentColumns")?.addEventListener("click", () => {
        modalState.Students.selected = typeConfig.Students.columns.map((c) => c.key);
        renderModalSelection("Students");
        renderModalTable("Students");
    });
    getEl("selectAllContestColumns")?.addEventListener("click", () => {
        modalState.Contests.selected = typeConfig.Contests.columns.map((c) => c.key);
        renderModalSelection("Contests");
        renderModalTable("Contests");
    });
    getEl("selectAllProbColumns")?.addEventListener("click", () => {
        modalState.Problems.selected = typeConfig.Problems.columns.map((c) => c.key);
        renderModalSelection("Problems");
        renderModalTable("Problems");
    });

    // Modal close hooks
    ["closeExportModal", "closeStudentExportModal", "closeContestModal", "closeProblemsModal"].forEach((id) => {
        getEl(id)?.addEventListener("click", closeAllModals);
    });

    // Modal live filter hooks
    Object.keys(modalMap).forEach((type) => {
        const map = modalMap[type];
        [map.searchId, map.sortId].forEach((id) => {
            getEl(id)?.addEventListener("input", () => renderModalTable(type));
            getEl(id)?.addEventListener("change", () => renderModalTable(type));
        });
    });
    ["studentExportFilterYear", "studentExportFilterSection", "studentExportFilterDept"].forEach((id) => {
        getEl(id)?.addEventListener("change", () => renderModalTable("Students"));
    });
    ["contestFilterSubject", "contestStartDate", "contestEndDate"].forEach((id) => {
        getEl(id)?.addEventListener("change", () => renderModalTable("Contests"));
    });
    getEl("probFilterDifficulty")?.addEventListener("change", () => renderModalTable("Problems"));

    // Populate modal filter dropdowns from dynamic metadata
    const fillSelect = (id, values, label) => {
        const sel = getEl(id);
        if (!sel) return;
        sel.innerHTML = `<option value="all">${label}</option>` + (values || []).map((v) => `<option value="${v}">${v}</option>`).join("");
    };
    fillSelect("studentExportFilterYear", filtersMeta.years, "Year: All");
    fillSelect("studentExportFilterSection", filtersMeta.sections, "Sec: All");
    fillSelect("studentExportFilterDept", filtersMeta.departments, "Dept: All");
    fillSelect("contestFilterSubject", filtersMeta.subjects, "Subject: All");
    fillSelect("probFilterDifficulty", filtersMeta.difficulties, "Difficulty: All");

    // Export buttons
    getEl("btnFinalDownloadExcel")?.addEventListener("click", () => exportRows("Faculty", "excel"));
    getEl("btnFinalDownloadPDF")?.addEventListener("click", () => exportRows("Faculty", "pdf"));
    getEl("btnStudentDownloadExcel")?.addEventListener("click", () => exportRows("Students", "excel"));
    getEl("btnStudentDownloadPDF")?.addEventListener("click", () => exportRows("Students", "pdf"));
    getEl("btnDownloadContestPDF")?.addEventListener("click", () => exportRows("Contests", "pdf"));
    getEl("btnDownloadProblemsPDF")?.addEventListener("click", () => exportRows("Problems", "pdf"));

    // Boot
    renderSidebarThemeShell();
    setCurrentDate();
    renderReportMeta();
    window.initReportUI();
});
