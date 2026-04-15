
document.addEventListener("DOMContentLoaded", function () {

    // Multi-page application - no SPA navigation needed


    const problemTabs = document.querySelectorAll('.problem-tab');
    const problemTabContents = document.querySelectorAll('.problem-tab-content');

    problemTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Reset ALL tabs to inactive state
            problemTabs.forEach(t => {
                // Remove active classes
                t.classList.remove('active', 'border-primary-500', 'text-primary-600', 'dark:text-primary-400', 'dark:border-primary-400');
                // Add inactive classes (gray text, transparent border)
                t.classList.add('border-transparent', 'text-gray-500', 'dark:text-gray-400');
            });

            // Set clicked tab to active state
            // Remove inactive classes
            tab.classList.remove('border-transparent', 'text-gray-500', 'dark:text-gray-400');
            // Add active classes
            tab.classList.add('active', 'border-primary-500', 'text-primary-600', 'dark:text-primary-400', 'dark:border-primary-400');

            const target = tab.dataset.tab;
            problemTabContents.forEach(content => {
                if (content.id === target) content.classList.remove('hidden');
                else content.classList.add('hidden');
            });
        });
    });

    // Default to "All Problems" tab on load
    const defaultTab = document.querySelector('[data-tab="all-problems"]');
    if (defaultTab) {
        defaultTab.click();
    }

    const btnCreateProblem = document.getElementById('btn-create-problem');
    const problemsListContainer = document.getElementById('problems-list-container');
    const problemFormView = document.getElementById('problem-form-view');
    const btnBackToList = document.getElementById('btn-back-to-list');

    if (btnCreateProblem) {
        btnCreateProblem.addEventListener('click', () => {
            problemsListContainer.classList.add('hidden');
            problemFormView.classList.remove('hidden');
        });
    }

    if (btnBackToList) {
        btnBackToList.addEventListener('click', () => {
            problemFormView.classList.add('hidden');
            problemsListContainer.classList.remove('hidden');
        });
    }

    const btnCancelForm = document.getElementById('btn-cancel-problem');
    if (btnCancelForm) {
        btnCancelForm.addEventListener('click', () => {
            problemFormView.classList.add('hidden');
            problemsListContainer.classList.remove('hidden');
        });
    }


    // Enhanced bookmark functionality with problem tracking across tabs
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.bookmark-btn');
        if (btn) {
            const problemRow = btn.closest('tr');
            const problemId = problemRow?.dataset.problemId;
            const icon = btn.querySelector('i');

            if (icon.classList.contains('far')) {
                // Bookmark the problem
                icon.classList.remove('far');
                icon.classList.add('fas', 'text-yellow-400');

                // Clone problem to bookmarked tab if it exists
                if (problemId) {
                    addToBookmarkedTab(problemRow);
                    saveBookmarkState(problemId, true);
                }
            } else {
                // Unbookmark the problem
                icon.classList.add('far');
                icon.classList.remove('fas', 'text-yellow-400');

                // Remove from bookmarked tab
                if (problemId) {
                    removeFromBookmarkedTab(problemId);
                    saveBookmarkState(problemId, false);
                }
            }
        }

        // Edit button functionality
        const editBtn = e.target.closest('button[title="Edit"]');
        if (editBtn) {
            const problemRow = editBtn.closest('tr');
            const problemId = problemRow?.dataset.problemId;
            const problemTitle = problemRow?.querySelector('.text-sm.font-medium')?.textContent.trim();
            const problemTags = problemRow?.querySelectorAll('.text-xs.text-gray-500')[0]?.textContent.trim();
            const difficultyBadge = problemRow?.querySelector('.difficulty-badge') || problemRow?.querySelector('span[class*="rounded-full"]');
            const difficultyText = difficultyBadge?.textContent.trim();

            // Open edit modal and populate with current data
            openEditModal(problemId, problemTitle, problemTags, difficultyText);
        }
        // Delete button functionality
        const deleteBtn = e.target.closest('button[title="Delete"]');
        if (deleteBtn) {
            const problemRow = deleteBtn.closest('tr');
            const problemId = problemRow?.dataset.problemId;
            const problemTitle = problemRow?.querySelector('.text-sm.font-medium')?.textContent.trim();

            if (confirm(`Are you sure you want to delete:\n"${problemTitle}"?\n\nThis action cannot be undone.`)) {
                // Add fade-out animation
                problemRow.style.transition = 'opacity 0.3s ease-out';
                problemRow.style.opacity = '0';

                setTimeout(() => {
                    problemRow.remove();
                    // Show success message
                    showToast('Problem deleted successfully', 'success');
                }, 300);
            }
        }

        // Remove bookmark button (in Bookmarked Problems tab)
        const removeBtn = e.target.closest('button[title="Remove Bookmark"]');
        if (removeBtn) {
            const problemRow = removeBtn.closest('tr');
            const problemId = problemRow?.dataset.problemId;
            const problemTitle = problemRow?.querySelector('.text-sm.font-medium')?.textContent.trim();

            if (confirm(`Remove "${problemTitle}" from bookmarks?`)) {
                // Add fade-out animation
                problemRow.style.transition = 'opacity 0.3s ease-out';
                problemRow.style.opacity = '0';

                setTimeout(() => {
                    problemRow.remove();

                    // Also update bookmark icon in All Problems tab
                    const allProblemsRow = document.querySelector(`#all-problems tr[data-problem-id="${problemId}"]`);
                    if (allProblemsRow) {
                        const bookmarkIcon = allProblemsRow.querySelector('.bookmark-btn i');
                        if (bookmarkIcon) {
                            bookmarkIcon.classList.add('far');
                            bookmarkIcon.classList.remove('fas', 'text-yellow-400');
                        }
                    }

                    showToast('Removed from bookmarks', 'info');
                    saveBookmarkState(problemId, false);
                    
                    // Check if empty
                    const bookmarkedTable = document.querySelector('#bookmarked-problems table tbody');
                    if (bookmarkedTable && !bookmarkedTable.querySelector('tr[data-problem-id]')) {
                        bookmarkedTable.innerHTML = '<tr><td colspan="3" class="py-8 text-center text-gray-500 dark:text-gray-400">No bookmarked problems.</td></tr>';
                    }
                }, 300);
            }
        }
    });

    // Helper function to add problem to bookmarked tab
    function addToBookmarkedTab(problemRow) {
        const bookmarkedTable = document.querySelector('#bookmarked-problems table tbody');
        if (!bookmarkedTable) return;

        const problemId = problemRow.dataset.problemId;

        // Check if already exists in bookmarked tab
        const existingBookmark = bookmarkedTable.querySelector(`tr[data-problem-id="${problemId}"]`);
        if (existingBookmark) return;

        // Remove the empty message row if it's there
        const emptyRow = bookmarkedTable.querySelector('tr td[colspan="3"]');
        if (emptyRow) emptyRow.parentElement.remove();

        // Clone the row
        const clonedRow = problemRow.cloneNode(true);

        // Modify the action buttons for bookmarked tab
        const actionsCell = clonedRow.querySelector('td:last-child > div');
        if (actionsCell) {
            actionsCell.innerHTML = `
                <a href="/hos/view-problem/${problemId}"
                    class="bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-md text-xs font-medium transition-colors">View</a>
                <button
                    class="text-red-500 hover:text-red-700 transition-colors flex items-center gap-1 text-xs font-medium bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded ml-2"
                    title="Remove Bookmark">
                    <i class="fas fa-times"></i> Remove
                </button>
            `;
        }

        bookmarkedTable.appendChild(clonedRow);
    }

    // Helper function to remove problem from bookmarked tab
    function removeFromBookmarkedTab(problemId) {
        const bookmarkedTable = document.querySelector('#bookmarked-problems table tbody');
        if (!bookmarkedTable) return;

        const bookmarkedRow = bookmarkedTable.querySelector(`tr[data-problem-id="${problemId}"]`);
        if (bookmarkedRow) {
            bookmarkedRow.style.transition = 'opacity 0.3s ease-out';
            bookmarkedRow.style.opacity = '0';

            setTimeout(() => {
                bookmarkedRow.remove();
                if (!bookmarkedTable.querySelector('tr[data-problem-id]')) {
                    bookmarkedTable.innerHTML = '<tr><td colspan="3" class="py-8 text-center text-gray-500 dark:text-gray-400">No bookmarked problems.</td></tr>';
                }
            }, 300);
        }
    }

    // DB-backed bookmark handlers
    async function saveBookmarkState(problemId, isBookmarked) {
        try {
            const id = parseInt(problemId, 10);
            if (!id) return;
            if (isBookmarked) {
                await fetch('/hos/api/problem-bookmarks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ problemId: id })
                });
                return;
            }
            await fetch(`/hos/api/problem-bookmarks/${id}`, { method: 'DELETE' });
        } catch (e) {
            console.error('Error saving bookmark state', e);
        }
    }

    async function initBookmarks() {
        try {
            const res = await fetch('/hos/api/problem-bookmarks');
            if (!res.ok) return;
            const payload = await res.json();
            const bookmarks = Array.isArray(payload?.data) ? payload.data.map((value) => Number(value)) : [];
            if (!bookmarks.length) return;

            const allProblemsRows = document.querySelectorAll('#all-problems table tbody tr[data-problem-id]');
            allProblemsRows.forEach((row) => {
                const id = parseInt(row.dataset.problemId, 10);
                if (!bookmarks.includes(id)) return;
                const icon = row.querySelector('.bookmark-btn i');
                if (icon) {
                    icon.classList.remove('far');
                    icon.classList.add('fas', 'text-yellow-400');
                }
                addToBookmarkedTab(row);
            });
        } catch (e) {
            console.error('Error init bookmarks', e);
        }
    }

    // Initialize bookmarks on load
    initBookmarks();

    // Toast notification helper
    function showToast(message, type = 'info') {
        const existingToast = document.querySelector('.toast-notification');
        if (existingToast) existingToast.remove();

        const colors = {
            success: 'bg-green-500',
            error: 'bg-red-500',
            info: 'bg-blue-500',
            warning: 'bg-yellow-500'
        };

        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            info: 'fa-info-circle',
            warning: 'fa-exclamation-triangle'
        };

        const toast = document.createElement('div');
        toast.className = `toast-notification fixed bottom-6 right-6 ${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50 animate-slide-up`;
        toast.innerHTML = `
            <i class="fas ${icons[type]}"></i>
            <span class="text-sm font-medium">${message}</span>
        `;

        // Add animation style
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slide-up {
                from { transform: translateY(100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            .animate-slide-up { animation: slide-up 0.3s ease-out; }
        `;
        document.head.appendChild(style);

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.transition = 'opacity 0.3s ease-out';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Edit Modal Functionality
    const editModal = document.getElementById('editProblemModal');
    const editForm = document.getElementById('editProblemForm');
    const editProblemId = document.getElementById('editProblemId');
    const editProblemTitle = document.getElementById('editProblemTitle');
    const editProblemTags = document.getElementById('editProblemTags');
    const editProblemDifficulty = document.getElementById('editProblemDifficulty');
    const editProblemDescription = document.getElementById('editProblemDescription');
    const closeEditModal = document.getElementById('closeEditModal');
    const cancelEditBtn = document.getElementById('cancelEditBtn');

    // Preview elements
    const previewProblemTitle = document.getElementById('previewProblemTitle');
    const previewDifficultyBadge = document.getElementById('previewDifficultyBadge');
    const previewProblemTags = document.getElementById('previewProblemTags');

    // Function to open edit modal and populate with data
    function openEditModal(problemId, title, tags, difficulty) {
        if (!editModal) return;

        // Populate form fields
        editProblemId.value = problemId || '';
        editProblemTitle.value = title || '';
        editProblemTags.value = tags || '';
        editProblemDifficulty.value = difficulty || '';
        editProblemDescription.value = '';

        // Update preview
        updatePreview();

        // Show modal
        editModal.classList.remove('hidden');
        editProblemTitle.focus();
    }

    // Function to close edit modal
    function closeEditModalFunc() {
        if (editModal) {
            editModal.classList.add('hidden');
            editForm.reset();
        }
    }

    // Close modal handlers
    if (closeEditModal) {
        closeEditModal.addEventListener('click', closeEditModalFunc);
    }

    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', closeEditModalFunc);
    }

    // Close on background click
    if (editModal) {
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) {
                closeEditModalFunc();
            }
        });
    }

    // Live preview update
    function updatePreview() {
        const title = editProblemTitle.value || 'Problem Title';
        const tags = editProblemTags.value || 'No tags';
        const difficulty = editProblemDifficulty.value || 'Medium';

        previewProblemTitle.textContent = title;
        previewProblemTags.textContent = tags;

        // Update difficulty badge styling
        const difficultyColors = {
            'Easy': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
            'Medium': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
            'Hard': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
        };

        previewDifficultyBadge.className = `px-2 py-1 text-xs font-medium rounded-full ${difficultyColors[difficulty] || difficultyColors['Medium']}`;
        previewDifficultyBadge.textContent = difficulty;
    }

    // Add event listeners for live preview
    if (editProblemTitle) {
        editProblemTitle.addEventListener('input', updatePreview);
    }
    if (editProblemTags) {
        editProblemTags.addEventListener('input', updatePreview);
    }
    if (editProblemDifficulty) {
        editProblemDifficulty.addEventListener('change', updatePreview);
    }

    // Handle form submission
    if (editForm) {
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const problemId = editProblemId.value;
            const title = editProblemTitle.value.trim();
            const tags = editProblemTags.value.trim();
            const difficulty = editProblemDifficulty.value;

            if (!title || !tags || !difficulty) {
                showToast('Please fill in all required fields', 'warning');
                return;
            }

            // Update the problem row in the table
            updateProblemRow(problemId, title, tags, difficulty);

            // Close modal and show success
            closeEditModalFunc();
            showToast('Problem updated successfully!', 'success');
        });
    }

    // Function to update problem row in table
    function updateProblemRow(problemId, title, tags, difficulty) {
        // Find the row in all relevant tables
        const tables = [
            document.querySelector('#all-problems table tbody'),
            document.querySelector('#created-problems table tbody'),
            document.querySelector('#bookmarked-problems table tbody')
        ];

        tables.forEach(table => {
            if (!table) return;

            const row = table.querySelector(`tr[data-problem-id="${problemId}"]`);
            if (!row) return;

            // Update title
            const titleElement = row.querySelector('.text-sm.font-medium');
            if (titleElement) {
                titleElement.textContent = title;
            }

            // Update tags
            const tagsElement = row.querySelector('.text-xs.text-gray-500');
            if (tagsElement) {
                tagsElement.textContent = tags;
            }

            // Update difficulty badge
            const difficultyBadge = row.querySelector('.difficulty-badge') || row.querySelector('span[class*="rounded-full"]');
            if (difficultyBadge) {
                const difficultyColors = {
                    'Easy': 'difficulty-badge px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
                    'Medium': 'difficulty-badge px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
                    'Hard': 'difficulty-badge px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                };

                difficultyBadge.className = difficultyColors[difficulty] || difficultyColors['Medium'];
                difficultyBadge.textContent = difficulty;
            }
        });
    }



    const btnCreateContest = document.getElementById('btn-create-contest');
    const contestFormView = document.getElementById('contest-form-view');
    const sectionManageContests = document.getElementById('section-manage-contests');
    const btnBackToContestList = document.getElementById('btn-back-to-contest-list');

    // Toggle Contest Form
    if (btnCreateContest && contestFormView && sectionManageContests) {
        btnCreateContest.addEventListener('click', () => {
            // Hide the list part specifically, but we are ALREADY in #section-manage-contests
            // The structure is: #section-manage-contests (List) AND #contest-form-view (Form) are siblings?
            // Wait, my HTML edit put them as siblings in the HTML file, but currently only one CONTENT section is shown at a time via `showSection`.
            // BUT, #contest-form-view is defined as a sibling of #section-manage-contests in the main structure?
            // Let's check the HTML structure I wrote.
            // I wrote: <div id="section-manage-contests" class="content-section">...</div> AND <div id="contest-form-view" class="...">...</div>
            // Wait, if #contest-form-view is NOT a `content-section`, it won't be hidden by `showSection` automatically if I navigate away.
            // But here I just want to toggle visibility WITHIN the contest tab.
            // Actually, if I want `showSection` to manage top-level tabs, `section-manage-contests` handles the nav.
            // When I click "Create Contest", I should probably hide the children of `section-manage-contests` or hide the section itself if the form is separate?
            // The form is separate `div id="contest-form-view"`.
            // So:
            sectionManageContests.classList.add('hidden');
            contestFormView.classList.remove('hidden');
        });
    }

    if (btnBackToContestList) {
        btnBackToContestList.addEventListener('click', () => {
            contestFormView.classList.add('hidden');
            sectionManageContests.classList.remove('hidden');
        });
    }

    const btnCancelContestForm = document.getElementById('btn-cancel-contest-form');
    if (btnCancelContestForm) {
        btnCancelContestForm.addEventListener('click', () => {
            contestFormView.classList.add('hidden');
            sectionManageContests.classList.remove('hidden');
        });
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

    const sectionManageFaculty = document.getElementById('section-manage-faculty');
    const facultyFormView = document.getElementById('faculty-form-view');
    const btnBackToFacultyList = document.getElementById('btn-back-to-faculty-list');
    const btnCancelFacultyEdit = document.getElementById('btn-cancel-faculty-edit');
    const btnAddFaculty = document.getElementById('btn-add-faculty');

    if (sectionManageFaculty && facultyFormView) {

        // Add Faculty Button
        if (btnAddFaculty) {
            btnAddFaculty.addEventListener('click', () => {
                sectionManageFaculty.classList.add('hidden');
                facultyFormView.classList.remove('hidden');
            });
        }

        // Event delegation for Edit buttons in the table
        sectionManageFaculty.addEventListener('click', (e) => {
            const editBtn = e.target.closest('button');
            if (editBtn && editBtn.textContent.trim() === 'Edit') {
                sectionManageFaculty.classList.add('hidden');
                facultyFormView.classList.remove('hidden');
            }
        });

        // Back Button
        if (btnBackToFacultyList) {
            btnBackToFacultyList.addEventListener('click', () => {
                facultyFormView.classList.add('hidden');
                sectionManageFaculty.classList.remove('hidden');
            });
        }

        // Cancel Button
        if (btnCancelFacultyEdit) {
            btnCancelFacultyEdit.addEventListener('click', () => {
                facultyFormView.classList.add('hidden');
                sectionManageFaculty.classList.remove('hidden');
            });
        }
    }

    const btnExportFaculty = document.getElementById('btn-export-faculty');
    const exportModal = document.getElementById('exportPreviewModal');
    const closeExportModalBtn = document.getElementById('closeExportModal');
    const exportPreviewTableBody = document.getElementById('exportTableBody');
    const exportTableHeadRow = document.getElementById('exportTableHeadRow');
    const columnSelectionList = document.getElementById('columnSelectionList');
    const selectAllColumnsBtn = document.getElementById('selectAllColumns');
    const exportSearchInput = document.getElementById('exportSearchInput');
    const exportFilterYear = document.getElementById('exportFilterYear');
    const exportFilterSection = document.getElementById('exportFilterSection');
    const exportFilterSubject = document.getElementById('exportFilterSubject');
    const exportSortSelect = document.getElementById('exportSortSelect');
    const previewCount = document.getElementById('previewCount');
    const btnFinalDownloadPDF = document.getElementById('btnFinalDownloadPDF');
    const btnFinalDownloadExcel = document.getElementById('btnFinalDownloadExcel');

    // Mocked Data State
    let allFacultyData = [];
    let displayedData = [];

    // Column Definitions (ID, Label, Default Selected)
    // Column Definitions (ID, Label, Default Selected)
    const exportColumns = [
        { id: 'faculty_id', label: 'ID', selected: true, mock: true },           // 1. ID
        { id: 'name', label: 'Name', selected: true, mock: false },              // 2. Name
        { id: 'email', label: 'Email', selected: true, mock: false },            // 3. Email
        { id: 'mobile_no', label: 'Mob No', selected: true, mock: true },        // 4. Mob No (New)
        { id: 'subject_count', label: 'Sub No', selected: true, mock: false },   // 5. Sub No
        { id: 'subject_names', label: 'Sub Name', selected: true, mock: true },  // 6. Sub Name
        { id: 'joining_year', label: 'Year', selected: true, mock: true },       // 7. Year
        { id: 'section', label: 'Section', selected: true, mock: true },         // 8. Section
        { id: 'total_ques', label: 'Ques', selected: true, mock: true },         // 9. Ques
        { id: 'join_date', label: 'DOJ', selected: true, mock: true },           // 10. DOJ
        { id: 'department', label: 'Department', selected: true, mock: true },   // 11. Department

        // Others (Keep them for option but maybe unselected or at end)
        { id: 'photo', label: 'Photo', selected: false, mock: false },
        { id: 'contests', label: 'No. Contests', selected: false, mock: true },
        { id: 'hard_ques', label: 'Ques (Hard)', selected: false, mock: true },
        { id: 'med_ques', label: 'Ques (Med)', selected: false, mock: true },
        { id: 'easy_ques', label: 'Ques (Easy)', selected: false, mock: true }
    ];

    if (exportModal) {
        // Function to open modal
        const openFacultyExportModal = () => {
            scrapeAndMockFacultyData();
            renderColumnSelection();
            populateFilters();
            applyFiltersAndRender();
            exportModal.classList.remove('hidden');
        };

        // 1. Open Modal & Initialize Data (Button Trigger - Faculty Page)
        if (btnExportFaculty) {
            btnExportFaculty.addEventListener('click', openFacultyExportModal);
        }

        // Dropdown Trigger (Report Page)
        const reportDropdownRef = document.getElementById('reportTypeDropdown');
        if (reportDropdownRef) {
            reportDropdownRef.addEventListener('change', (e) => {
                if (e.target.value === "Faculty Report") {
                    openFacultyExportModal();
                    e.target.value = ""; // Reset
                }
            });
        }

        // Close Modal
        closeExportModalBtn.addEventListener('click', () => exportModal.classList.add('hidden'));

        // 2. Data Gathering Function
        function scrapeAndMockFacultyData() {
            const table = document.querySelector('#section-manage-faculty table');

            if (table) {
                const rows = Array.from(table.querySelectorAll('tbody tr'));
                if (rows.length === 0) {
                }
                allFacultyData = rows.map((row, index) => {
                    const cells = row.querySelectorAll('td');
                    // 0: Photo, 1: Name, 2: Email, 3: Subject Count

                    // Deterministic Mocking (Preserved)
                    const years = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
                    const sections = ["A", "B", "C", "D"];
                    const subjectsList = [
                        "Operating Systems", "DBMS", "Data Structures", "Algorithms",
                        "Computer Networks", "Artificial Intelligence", "Web Development", "Software Engineering"
                    ];

                    const joinYear = 2018 + (index % 5);
                    const joinMonth = (index % 12) + 1;
                    const joinDay = (index % 28) + 1;
                    const joinDateStr = `${joinYear}-${joinMonth.toString().padStart(2, '0')}-${joinDay.toString().padStart(2, '0')}`;

                    const name = cells[1]?.innerText.trim() || "Unknown";
                    const email = cells[2]?.innerText.trim() || "No Email";

                    return {
                        photo: "Image",
                        name: name,
                        email: email,
                        subject_count: cells[3]?.innerText.trim() || "0",
                        // Mocks with specific user requests
                        faculty_id: `FAC-${100 + index}`,
                        mobile_no: `98${Math.floor(10000000 + Math.random() * 90000000)}`, // Random Mob No
                        department: index % 3 === 0 ? "CSE" : (index % 2 === 0 ? "ECE" : "IT"),
                        join_date: joinDateStr,
                        joining_year: years[index % 4], // 1st Year, 2nd Year...
                        subject_names: subjectsList[index % subjectsList.length], // Specific Subjects
                        hard_ques: 5 + (index * 2),
                        med_ques: 10 + (index * 3),
                        easy_ques: 15 + (index * 4),
                        total_ques: 30 + (index * 9),
                        contests: 2 + (index % 5),
                        section: sections[index % 4] // A, B, C, D
                    };
                });
            } else {
                allFacultyData = Array.from({ length: 15 }).map((_, index) => {
                    const years = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
                    const sections = ["A", "B", "C", "D"];
                    const subjectsList = ["Operating Systems", "DBMS", "Data Structures", "Algorithms", "CN", "AI"];
                    const joinYear = 2018 + (index % 5);

                    return {
                        photo: "Image",
                        name: `Professor ${String.fromCharCode(65 + index)}`,
                        email: `prof.${String.fromCharCode(97 + index)}@example.com`,
                        subject_count: Math.floor(Math.random() * 5 + 1).toString(),
                        faculty_id: `FAC-${100 + index}`,
                        mobile_no: `98${Math.floor(10000000 + Math.random() * 90000000)}`,
                        department: index % 3 === 0 ? "CSE" : (index % 2 === 0 ? "ECE" : "IT"),
                        join_date: `${joinYear}-01-15`,
                        joining_year: years[index % 4],
                        subject_names: subjectsList[index % subjectsList.length],
                        total_ques: 30 + (index * 9),
                        contests: 2 + (index % 5),
                        section: sections[index % 4]
                    };
                });
            }
        }

        // 3. Render Columns Sidebar
        function renderColumnSelection() {
            columnSelectionList.innerHTML = '';
            exportColumns.forEach(col => {
                if (col.id === 'photo') return; // Skip photo selection

                const label = document.createElement('label');
                label.className = "flex items-center space-x-3 cursor-pointer group p-2 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-colors";
                label.innerHTML = `
                    <input type="checkbox" data-col="${col.id}" ${col.selected ? 'checked' : ''} 
                        class="rounded border-gray-300 text-primary-600 focus:ring-primary-500 transition-all">
                    <span class="text-sm text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white font-medium">${col.label}</span>
                `;

                label.querySelector('input').addEventListener('change', (e) => {
                    col.selected = e.target.checked;
                    applyFiltersAndRender();
                });

                columnSelectionList.appendChild(label);
            });
        }

        selectAllColumnsBtn.addEventListener('click', () => {
            const allChecked = exportColumns.every(c => c.selected || c.id === 'photo');
            exportColumns.forEach(c => { if (c.id !== 'photo') c.selected = !allChecked; });
            renderColumnSelection();
            applyFiltersAndRender();
        });

        // 4b. Populate Filters
        function populateFilters() {
            const fillSelect = (select, values, labelPrefix) => {
                select.innerHTML = `<option value="all">${labelPrefix}: All</option>`;
                values.forEach(v => {
                    const option = document.createElement('option');
                    option.value = v;
                    option.textContent = v;
                    select.appendChild(option);
                });
            };

            const years = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
            fillSelect(exportFilterYear, years, "Year");

            const sections = ["A", "B", "C", "D"];
            fillSelect(exportFilterSection, sections, "Sec");

            // Unique subjects from data
            const subjects = [...new Set(allFacultyData.map(d => d.subject_names))].sort();
            fillSelect(exportFilterSubject, subjects, "Sub");
        }

        // 4. Filter & Sort Logic
        function applyFiltersAndRender() {
            let filtered = [...allFacultyData];

            // Search
            const term = exportSearchInput.value.toLowerCase();
            if (term) {
                filtered = filtered.filter(item =>
                    item.name.toLowerCase().includes(term) ||
                    item.email.toLowerCase().includes(term) ||
                    item.faculty_id.toLowerCase().includes(term)
                );
            }

            // Year Filter
            if (exportFilterYear.value !== 'all') {
                filtered = filtered.filter(item => item.joining_year === exportFilterYear.value);
            }

            // Section Filter
            if (exportFilterSection.value !== 'all') {
                filtered = filtered.filter(item => item.section === exportFilterSection.value);
            }

            // Subject Filter
            if (exportFilterSubject.value !== 'all') {
                filtered = filtered.filter(item => item.subject_names.includes(exportFilterSubject.value));
            }

            // Sort
            const sortVal = exportSortSelect.value;
            filtered.sort((a, b) => {
                if (sortVal === 'name_asc') return a.name.localeCompare(b.name);
                if (sortVal === 'name_desc') return b.name.localeCompare(a.name);
                if (sortVal === 'date_new') return new Date(b.join_date) - new Date(a.join_date);
                return 0;
            });

            displayedData = filtered;
            renderPreviewTable();
        }

        // Event Listeners for Toolbar
        exportSearchInput.addEventListener('input', applyFiltersAndRender);
        exportSortSelect.addEventListener('change', applyFiltersAndRender);
        exportFilterYear.addEventListener('change', applyFiltersAndRender);
        exportFilterSection.addEventListener('change', applyFiltersAndRender);
        exportFilterSubject.addEventListener('change', applyFiltersAndRender);


        // 5. Render Table
        function renderPreviewTable() {
            // Use correct ID or reuse outer variables if they were properly scoped (but safely re-fetch matching HTML ID)
            const tableHead = document.getElementById('exportTableHeadRow');
            const tableBody = document.getElementById('exportTableBody'); // FIXED: ID was wrong

            if (!tableHead || !tableBody) {
                return;
            }

            // Filter Active Columns
            const activeCols = exportColumns.filter(c => c.selected);

            // Render Header with Select All
            let headerHTML = `<th class="px-6 py-3 bg-gray-50 dark:bg-gray-700/50 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-10">
                <input type="checkbox" id="selectAllFacultyRows" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500">
            </th>`;
            headerHTML += activeCols.map(col => `
                <th class="px-6 py-3 bg-gray-50 dark:bg-gray-700/50 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    ${col.label}
                </th>
            `).join('');
            tableHead.innerHTML = headerHTML;

            // Select All Listener
            const selectAllCheck = document.getElementById('selectAllFacultyRows');
            if (selectAllCheck) {
                const allSelected = displayedData.length > 0 && displayedData.every(d => d.isSelected);
                selectAllCheck.checked = allSelected;
                selectAllCheck.addEventListener('change', (e) => {
                    const checked = e.target.checked;
                    displayedData.forEach(d => d.isSelected = checked);
                    renderPreviewTable();
                });
            }

            // Render Body
            if (displayedData.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="100%" class="px-6 py-4 text-center text-gray-500">No records found matching filters.</td></tr>';
            } else {
                tableBody.innerHTML = displayedData.map((item, idx) => `
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${item.isSelected ? 'bg-blue-50 dark:bg-blue-900/10' : ''}">
                        <td class="px-6 py-4 whitespace-nowrap">
                            <input type="checkbox" data-idx="${idx}" class="faculty-row-checkbox rounded border-gray-300 text-primary-600 focus:ring-primary-500" ${item.isSelected ? 'checked' : ''}>
                        </td>
                        ${activeCols.map(col => `
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">
                                ${item[col.id]}
                            </td>
                        `).join('')}
                    </tr>
                `).join('');
            }

            // Row Checkbox Listeners
            document.querySelectorAll('.faculty-row-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const idx = e.target.dataset.idx;
                    displayedData[idx].isSelected = e.target.checked;
                    renderPreviewTable();
                });
            });

            // Update Counts
            const selectedCount = displayedData.filter(d => d.isSelected).length;
            const countText = selectedCount > 0
                ? `${selectedCount} selected (of ${displayedData.length})`
                : `${displayedData.length} records`;

            if (previewCount) previewCount.textContent = countText;
        }

        // 6. Download Handlers
        // 6. Download Handlers
        btnFinalDownloadExcel.addEventListener('click', () => {
            try {
                if (typeof XLSX === 'undefined') {
                    alert('Error: Excel library (SheetJS) not loaded. Please check your internet connection and refresh.');
                    return;
                }
                const activeCols = exportColumns.filter(c => c.selected);
                const selectedRows = displayedData.filter(d => d.isSelected);
                const dataToExport = selectedRows.length > 0 ? selectedRows : displayedData;

                if (dataToExport.length === 0) {
                    alert('No data to export!');
                    return;
                }

                const excelData = dataToExport.map(item => {
                    const row = {};
                    activeCols.forEach(col => row[col.label] = item[col.id]);
                    return row;
                });
                const ws = XLSX.utils.json_to_sheet(excelData);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Faculty_Report");
                XLSX.writeFile(wb, "Faculty_Report.xlsx");
            } catch (err) {
                alert('An error occurred during Excel export: ' + err.message);
            }
        });

        btnFinalDownloadPDF.addEventListener('click', () => {
            try {
                const activeCols = exportColumns.filter(c => c.selected);
                const selectedRows = displayedData.filter(d => d.isSelected);
                const dataToExport = selectedRows.length > 0 ? selectedRows : displayedData;

                if (dataToExport.length === 0) {
                    alert('No data to print!');
                    return;
                }

                const reportDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

                // Construct Print Window Content
                const printWindow = window.open('', '_blank');
                if (!printWindow) {
                    alert('Pop-up blocked! Please allow pop-ups for this site to print reports.');
                    return;
                }

                const htmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Faculty Report - ${reportDate}</title>
                        <style>
                            body { font-family: 'Helvetica', 'Arial', sans-serif; margin: 0; padding: 0; color: #333; }
                            .header { background-color: #1e4a7a; color: white; padding: 40px 20px; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                            .header h1 { margin: 0; font-size: 24px; font-weight: bold; }
                            .header h2 { margin: 5px 0 0; font-size: 16px; font-weight: normal; opacity: 0.9; }
                            .meta-info { display: flex; justify-content: space-between; padding: 20px 40px; border-bottom: 2px solid #f0f0f0; font-size: 14px; color: #666; }
                            .content { padding: 40px; }
                            table { w-full; width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
                            th { background-color: #f8fafc; color: #475569; font-weight: bold; text-align: left; padding: 12px 15px; border-bottom: 2px solid #e2e8f0; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; -webkit-print-color-adjust: exact; }
                            td { padding: 12px 15px; border-bottom: 1px solid #e2e8f0; color: #1f2937; }
                            tr:nth-child(even) { background-color: #f8fafc; -webkit-print-color-adjust: exact; }
                            .footer { position: fixed; bottom: 0; left: 0; width: 100%; padding: 15px 40px; background: white; font-size: 10px; color: #999; border-top: 1px solid #eee; display: flex; justify-content: space-between; }
                            
                            @media print {
                                body { -webkit-print-color-adjust: exact; }
                                .no-print { display: none; }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>MIT Meerut</h1>
                            <h2>Faculty Report</h2>
                        </div>

                        <div class="meta-info">
                            <div>
                                <strong>Department:</strong> CSE<br>
                                <strong>HOD:</strong> Dr. Vishnu Gupta
                            </div>
                            <div style="text-align: right;">
                                <strong>Date:</strong> ${reportDate}<br>
                                <strong>Total Records:</strong> ${dataToExport.length}
                            </div>
                        </div>

                        <div class="content">
                            <table>
                                <thead>
                                    <tr>
                                        ${activeCols.map(c => `<th>${c.label}</th>`).join('')}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${dataToExport.map(row => `
                                        <tr>
                                            ${activeCols.map(c => `<td>${row[c.id]}</td>`).join('')}
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>

                        <div class="footer">
                            <span>Generated by CampusCode LMS</span>
                            <span>Page 1 of 1</span>
                        </div>

                        <script>
                            window.onload = function() { window.print(); }
                        </script>
                    </body>
                    </html>
                `;

                printWindow.document.write(htmlContent);
                printWindow.document.close();

                // Wait for content to load then print
                printWindow.focus();
                setTimeout(() => {
                    printWindow.print();
                    // Optional: printWindow.close(); // Auto-close after print logic if desired
                }, 500);

            } catch (err) {
                alert('An error occurred during printing: ' + err.message);
            }
        });
    }

    const btnExportStudent = document.getElementById('btn-export-student');
    const reportDropdown = document.getElementById('reportTypeDropdown'); // NEW: Dropdown in report.html
    const studentExportModal = document.getElementById('studentExportPreviewModal');
    const closeStudentExportModal = document.getElementById('closeStudentExportModal');
    const studentExportPreviewTableBody = document.getElementById('studentExportTableBody');
    const studentExportTableHeadRow = document.getElementById('studentExportTableHeadRow');
    const studentColumnSelectionList = document.getElementById('studentColumnSelectionList');
    const selectAllStudentColumnsBtn = document.getElementById('selectAllStudentColumns');
    const studentExportSearchInput = document.getElementById('studentExportSearchInput');
    const studentExportFilterYear = document.getElementById('studentExportFilterYear');
    const studentExportFilterSection = document.getElementById('studentExportFilterSection');
    const studentExportFilterDept = document.getElementById('studentExportFilterDept');
    const studentExportSortSelect = document.getElementById('studentExportSortSelect');
    const studentPreviewCount = document.getElementById('studentPreviewCount');
    const btnStudentDownloadPDF = document.getElementById('btnStudentDownloadPDF');
    const btnStudentDownloadExcel = document.getElementById('btnStudentDownloadExcel');

    let allStudentData = [];
    let displayedStudentData = [];

    // Columns Configuration
    const studentExportColumns = [
        { id: 'student_id', label: 'ID', selected: true },
        { id: 'name', label: 'Name', selected: true },
        { id: 'email', label: 'Email', selected: true },
        { id: 'year', label: 'Year', selected: true },
        { id: 'section', label: 'Section', selected: true },
        { id: 'global_rank', label: 'Global Rank', selected: true },
        { id: 'college_rank', label: 'College Rank', selected: true },
        { id: 'solved_hard', label: 'Solved (Hard)', selected: true, mock: true },
        { id: 'solved_medium', label: 'Solved (Med)', selected: true, mock: true },
        { id: 'solved_easy', label: 'Solved (Easy)', selected: true, mock: true },
        { id: 'department', label: 'Department', selected: true, mock: true }
    ];

    if (studentExportModal) { // Check if modal exists (it will be in student.html and report.html)

        const openStudentExportModal = () => {
            scrapeAndMockStudentData();
            renderStudentColumnSelection();
            populateStudentFilters();
            applyStudentFilters();
            studentExportModal.classList.remove('hidden');
        };

        if (btnExportStudent) {
            btnExportStudent.addEventListener('click', openStudentExportModal);
        }

        if (reportDropdown) {
            reportDropdown.addEventListener('change', (e) => {
                if (e.target.value === "Student Report") {
                    openStudentExportModal();
                    e.target.value = ""; // Reset dropdown so it can be selected again
                }
            });
        }

        closeStudentExportModal.addEventListener('click', () => studentExportModal.classList.add('hidden'));

        // 1. Scrape & Mock
        function scrapeAndMockStudentData() {
            const table = document.querySelector('#section-manage-class table');

            if (table) {
                // Table Exists (student.html): Scrape + Mock
                const rows = Array.from(table.querySelectorAll('tbody tr'));
                allStudentData = rows.map((row, index) => {
                    const cells = row.querySelectorAll('td');
                    // Table: 0: ID, 1: Name, 2: Section, 3: Year, 4: Email, 5: Global Rank, 6: College Rank

                    // Mocks
                    const depts = ["CSE", "ECE", "IT", "ME"];
                    const hard = Math.floor(Math.random() * 50);
                    const med = Math.floor(Math.random() * 100);
                    const easy = Math.floor(Math.random() * 200);

                    return {
                        student_id: cells[0]?.innerText.trim(),
                        name: cells[1]?.innerText.trim(),
                        section: cells[2]?.innerText.trim(),
                        year: cells[3]?.innerText.trim(),
                        email: cells[4]?.innerText.trim(),
                        global_rank: cells[5]?.innerText.trim(),
                        college_rank: cells[6]?.innerText.trim(),
                        // Mocked Data
                        department: depts[index % 4],
                        solved_hard: hard,
                        solved_medium: med,
                        solved_easy: easy,
                        isSelected: false // Reset selection
                    };
                });
            } else {
                // Table Missing (report.html): Pure Mock

                allStudentData = Array.from({ length: 15 }).map((_, i) => {
                    const depts = ["CSE", "ECE", "IT", "ME"];
                    const sections = ["A", "B", "C"];
                    const years = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

                    return {
                        student_id: `STU-2024-${100 + i}`,
                        name: `Student ${String.fromCharCode(65 + i)}`,
                        section: sections[i % 3],
                        year: years[i % 4],
                        email: `student${i}@college.edu`,
                        global_rank: `${1200 + (i * 10)}`,
                        college_rank: `${10 + i}`,
                        department: depts[i % 4],
                        solved_hard: Math.floor(Math.random() * 50),
                        solved_medium: Math.floor(Math.random() * 100),
                        solved_easy: Math.floor(Math.random() * 200),
                        isSelected: false
                    };
                });
            }
        }

        // 2. Render Columns
        function renderStudentColumnSelection() {
            studentColumnSelectionList.innerHTML = '';
            studentExportColumns.forEach(col => {
                const label = document.createElement('label');
                label.className = "flex items-center space-x-3 cursor-pointer group p-2 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-colors";
                label.innerHTML = `
                    <input type="checkbox" ${col.selected ? 'checked' : ''} class="rounded border-gray-300 text-primary-600 focus:ring-primary-500 transition-all">
                    <span class="text-sm text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white font-medium">${col.label}</span>
                `;
                label.querySelector('input').addEventListener('change', (e) => {
                    col.selected = e.target.checked;
                    renderStudentPreviewTable(); // Re-render table to show/hide cols
                });
                studentColumnSelectionList.appendChild(label);
            });
        }

        selectAllStudentColumnsBtn.addEventListener('click', () => {
            const allChecked = studentExportColumns.every(c => c.selected);
            studentExportColumns.forEach(c => c.selected = !allChecked);
            renderStudentColumnSelection();
            renderStudentPreviewTable();
        });

        // 3. Populate Filters
        function populateStudentFilters() {
            const uniqueYears = [...new Set(allStudentData.map(d => d.year))].sort();
            const uniqueSections = [...new Set(allStudentData.map(d => d.section))].sort();
            const uniqueDepts = [...new Set(allStudentData.map(d => d.department))].sort();

            const fill = (sel, arr, prefix) => {
                sel.innerHTML = `<option value="all">${prefix}: All</option>`;
                arr.forEach(v => sel.innerHTML += `<option value="${v}">${v}</option>`);
            };

            fill(studentExportFilterYear, uniqueYears, "Year");
            fill(studentExportFilterSection, uniqueSections, "Sec");
            fill(studentExportFilterDept, uniqueDepts, "Dept");
        }

        // 4. Apply Filters
        function applyStudentFilters() {
            let filtered = [...allStudentData];
            const term = studentExportSearchInput.value.toLowerCase();
            const year = studentExportFilterYear.value;
            const sec = studentExportFilterSection.value;
            const dept = studentExportFilterDept.value;
            const sort = studentExportSortSelect.value;

            if (term) {
                filtered = filtered.filter(d =>
                    d.name.toLowerCase().includes(term) ||
                    d.student_id.toLowerCase().includes(term) ||
                    d.email.toLowerCase().includes(term)
                );
            }
            if (year !== 'all') filtered = filtered.filter(d => d.year === year);
            if (sec !== 'all') filtered = filtered.filter(d => d.section === sec);
            if (dept !== 'all') filtered = filtered.filter(d => d.department === dept);

            // Sorting
            filtered.sort((a, b) => {
                if (sort === 'name_asc') return a.name.localeCompare(b.name);
                if (sort === 'name_desc') return b.name.localeCompare(a.name);
                if (sort === 'rank_high') {
                    const rA = parseInt(a.global_rank.replace(/,/g, '')) || 999999;
                    const rB = parseInt(b.global_rank.replace(/,/g, '')) || 999999;
                    return rA - rB; // Lower rank number is better (top 1)
                }
                return 0;
            });

            displayedStudentData = filtered;
            renderStudentPreviewTable();
        }

        [studentExportSearchInput, studentExportFilterYear, studentExportFilterSection, studentExportFilterDept, studentExportSortSelect].forEach(el => {
            el.addEventListener('input', applyStudentFilters);
        });

        // 5. Render Table
        function renderStudentPreviewTable() {
            if (!studentExportTableHeadRow || !studentExportPreviewTableBody) return;

            const activeCols = studentExportColumns.filter(c => c.selected);

            // Header
            studentExportTableHeadRow.innerHTML = `
                <th class="px-6 py-3 w-10">
                    <input type="checkbox" id="selectAllStudentRows" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500">
                </th>
                ${activeCols.map(c => `<th class="px-6 py-3">${c.label}</th>`).join('')}
            `;

            // Select All Logic
            const selectAllRowsCb = document.getElementById('selectAllStudentRows');
            if (selectAllRowsCb) {
                selectAllRowsCb.checked = displayedStudentData.length > 0 && displayedStudentData.every(d => d.isSelected);
                selectAllRowsCb.addEventListener('change', (e) => {
                    displayedStudentData.forEach(d => d.isSelected = e.target.checked);
                    renderStudentPreviewTable();
                });
            }

            // Body
            studentExportPreviewTableBody.innerHTML = displayedStudentData.map((row, idx) => `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 ${row.isSelected ? 'bg-blue-50 dark:bg-blue-900/10' : ''}">
                    <td class="px-6 py-4">
                        <input type="checkbox" data-idx="${idx}" class="student-row-checkbox rounded border-gray-300 text-primary-600 focus:ring-primary-500" ${row.isSelected ? 'checked' : ''}>
                    </td>
                    ${activeCols.map(c => `<td class="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-gray-300">${row[c.id]}</td>`).join('')}
                </tr>
            `).join('');

            // Row Checkbox Listeners
            document.querySelectorAll('.student-row-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const idx = e.target.dataset.idx;
                    displayedStudentData[idx].isSelected = e.target.checked;
                    renderStudentPreviewTable();
                });
            });

            // Count
            const selectedCount = displayedStudentData.filter(d => d.isSelected).length;
            studentPreviewCount.textContent = selectedCount > 0
                ? `${selectedCount} selected (of ${displayedStudentData.length})`
                : `${displayedStudentData.length} records`;
        }

        // 6. Download Excel
        btnStudentDownloadExcel.addEventListener('click', () => {
            if (typeof XLSX === 'undefined') {
                alert('Excel library not loaded.');
                return;
            }
            const activeCols = studentExportColumns.filter(c => c.selected);
            const selectedRows = displayedStudentData.filter(d => d.isSelected);
            const dataToExport = selectedRows.length > 0 ? selectedRows : displayedStudentData;

            if (dataToExport.length === 0) {
                alert('No data to export.');
                return;
            }

            const exportData = dataToExport.map(row => {
                const newRow = {};
                activeCols.forEach(col => newRow[col.label] = row[col.id]);
                return newRow;
            });

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Student_Report");
            XLSX.writeFile(wb, "Student_Report.xlsx");
        });

        // 7. Print Report
        btnStudentDownloadPDF.addEventListener('click', () => {
            const activeCols = studentExportColumns.filter(c => c.selected);
            const selectedRows = displayedStudentData.filter(d => d.isSelected);
            const dataToExport = selectedRows.length > 0 ? selectedRows : displayedStudentData;

            if (dataToExport.length === 0) {
                alert('No data to print.');
                return;
            }

            const printWin = window.open('', '_blank');
            const date = new Date().toLocaleDateString();

            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Student Report - ${date}</title>
                    <style>
                        body { font-family: Helvetica, sans-serif; padding: 20px; }
                        h1 { color: #1e4a7a; text-align: center; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f8fafc; color: #333; }
                        tr:nth-child(even) { background-color: #f9f9f9; }
                    </style>
                </head>
                <body>
                    <h1>Student Report</h1>
                    <p>Date: ${date}</p>
                    <p>Total Records: ${dataToExport.length}</p>
                    <table>
                        <thead>
                            <tr>${activeCols.map(c => `<th>${c.label}</th>`).join('')}</tr>
                        </thead>
                        <tbody>
                            ${dataToExport.map(row => `
                                <tr>${activeCols.map(c => `<td>${row[c.id]}</td>`).join('')}</tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <script>window.onload = () => window.print();</script>
                </body>
                </html>
            `;
            printWin.document.write(html);
            printWin.document.close();
        });
    }

    const btnExportProblems = document.getElementById('btn-export-problems');
    const probModal = document.getElementById('exportProblemsModal');
    const closeProbModal = document.getElementById('closeProblemsModal');

    // Config
    const probColumns = [
        { id: 'id', label: 'ID', selected: true },
        { id: 'title', label: 'Title', selected: true },
        { id: 'description', label: 'Description', selected: true },
        { id: 'subject', label: 'Subject', selected: true },
        { id: 'difficulty', label: 'Difficulty', selected: true },
        { id: 'date', label: 'Date', selected: true }
    ];

    let allProbData = [];
    let displayedProbData = [];

    if (btnExportProblems && probModal) {

        btnExportProblems.addEventListener('click', () => {
            // 1. Scrape & Mock
            scrapeAndMockProblems();
            // 2. Setup UI
            renderProbColumns();
            populateProbFilters();
            applyProbFilters();

            probModal.classList.remove('hidden');
        });

        closeProbModal.addEventListener('click', () => probModal.classList.add('hidden'));

        // Scrape
        function scrapeAndMockProblems() {
            // Scrape from the "tab-created" list items
            const items = Array.from(document.querySelectorAll('#tab-created .group'));

            allProbData = items.map((item, index) => {
                const title = item.querySelector('h4').innerText.trim();
                const difficulty = item.querySelector('.bg-yellow-100, .bg-green-100, .bg-red-100')?.innerText.trim() || "Medium";
                const badges = Array.from(item.querySelectorAll('.text-gray-500'));
                const subject = badges[0]?.innerText.replace('•', '').trim() || "General";

                // Mocks
                const date = new Date();
                date.setDate(date.getDate() - (index * 5));

                return {
                    id: `PROB-${1000 + index}`,
                    title: title,
                    description: `This is a sample description for ${title}. It involves optimizing space and time complexity using ${subject} concepts.`,
                    tags: ["Arrays", "Trees", "DP", "Graph"][index % 4],
                    subject: subject,
                    difficulty: difficulty,
                    date: date.toISOString().split('T')[0] // YYYY-MM-DD
                };
            });
        }

        // Columns
        function renderProbColumns() {
            const list = document.getElementById('probColumnSelectionList');
            if (!list) return;
            list.innerHTML = '';

            document.getElementById('selectAllProbColumns').onclick = () => {
                const all = probColumns.every(c => c.selected);
                probColumns.forEach(c => c.selected = !all);
                renderProbColumns();
                applyProbFilters();
            };

            probColumns.forEach(col => {
                const label = document.createElement('label');
                label.className = "flex items-center space-x-3 cursor-pointer group p-2 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-colors";
                label.innerHTML = `
                    <input type="checkbox" ${col.selected ? 'checked' : ''} class="rounded border-gray-300 text-primary-600 focus:ring-primary-500 transition-all">
                    <span class="text-sm text-gray-600 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white font-medium">${col.label}</span>
                `;
                label.querySelector('input').addEventListener('change', (e) => {
                    col.selected = e.target.checked;
                    applyProbFilters();
                });
                list.appendChild(label);
            });
        }

        // Filters
        function populateProbFilters() {
            const subSelect = document.getElementById('probFilterSubject');
            if (!subSelect) return;
            const subjects = [...new Set(allProbData.map(d => d.subject))].sort();
            subSelect.innerHTML = '<option value="all">Subject: All</option>';
            subjects.forEach(s => subSelect.innerHTML += `<option value="${s}">${s}</option>`);
        }

        // Apply Logic
        function applyProbFilters() {
            let filtered = [...allProbData];

            // Search
            const term = document.getElementById('probSearchInput').value.toLowerCase();
            if (term) filtered = filtered.filter(d => d.description.toLowerCase().includes(term) || d.tags.toLowerCase().includes(term));

            // Subject
            const sub = document.getElementById('probFilterSubject').value;
            if (sub !== 'all') filtered = filtered.filter(d => d.subject === sub);

            // Difficulty
            const diff = document.getElementById('probFilterDifficulty').value;
            if (diff !== 'all') filtered = filtered.filter(d => d.difficulty === diff);

            // Date Range
            const start = document.getElementById('probStartDate').value;
            const end = document.getElementById('probEndDate').value;
            if (start && end) {
                const s = new Date(start);
                const e = new Date(end);
                filtered = filtered.filter(d => {
                    const i = new Date(d.date);
                    return i >= s && i <= e;
                });
            }

            displayedProbData = filtered;
            renderProbTable();
        }

        // Render Table with Row Checkboxes
        function renderProbTable() {
            const tbody = document.getElementById('probTableBody');
            const thead = document.getElementById('probTableHeadRow');
            if (!tbody || !thead) return;

            const activeCols = probColumns.filter(c => c.selected);

            // Header with Select All Checkbox - Fixed HTML
            let headerHTML = `<th class="px-6 py-3 w-10">
                <input type="checkbox" id="selectAllRows" class="rounded border-gray-300 text-primary-600 focus:ring-primary-500">
            </th>`;
            headerHTML += activeCols.map(c => `<th class="px-6 py-3">${c.label}</th>`).join('');
            thead.innerHTML = headerHTML;

            // Listen for Select All Header
            const selectAllCheck = document.getElementById('selectAllRows');
            if (selectAllCheck) {
                const allSelected = displayedProbData.length > 0 && displayedProbData.every(d => d.isSelected);
                selectAllCheck.checked = allSelected;
                selectAllCheck.addEventListener('change', (e) => {
                    const checked = e.target.checked;
                    displayedProbData.forEach(d => d.isSelected = checked);
                    renderProbTable(); // Re-render to update row checkboxes
                });
            }

            // Body
            tbody.innerHTML = displayedProbData.map((row, idx) => `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 ${row.isSelected ? 'bg-blue-50 dark:bg-blue-900/10' : ''}">
                    <td class="px-6 py-4">
                        <input type="checkbox" data-idx="${idx}" class="row-checkbox rounded border-gray-300 text-primary-600 focus:ring-primary-500" ${row.isSelected ? 'checked' : ''}>
                    </td>
                    ${activeCols.map(c => `<td class="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-gray-300">${row[c.id]}</td>`).join('')}
                </tr>
            `).join('');

            // Listen for Row Checkboxes
            document.querySelectorAll('.row-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const idx = e.target.dataset.idx;
                    displayedProbData[idx].isSelected = e.target.checked;
                    renderProbTable(); // Update select all state and row styling
                });
            });

            // Update Counts
            const selectedCount = displayedProbData.filter(d => d.isSelected).length;
            const countText = selectedCount > 0
                ? `${selectedCount} selected (of ${displayedProbData.length})`
                : `${displayedProbData.length} records`;
            document.getElementById('probPreviewCount').textContent = countText;
        }

        const probFilters = ['probSearchInput', 'probFilterSubject', 'probFilterDifficulty', 'probStartDate', 'probEndDate'];
        probFilters.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', applyProbFilters);
        });

        // Print Report for Problems
        const btnDownloadProblemsPDF = document.getElementById('btnDownloadProblemsPDF');
        if (btnDownloadProblemsPDF) {
            btnDownloadProblemsPDF.addEventListener('click', () => {
                const activeCols = probColumns.filter(c => c.selected);

                // Determine Data to Export
                const selectedRows = displayedProbData.filter(d => d.isSelected);
                const dataToExport = selectedRows.length > 0 ? selectedRows : displayedProbData;
                const reportDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

                // Construct Print Window Content
                const printWindow = window.open('', '_blank');

                const htmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Problems Report - ${reportDate}</title>
                        <style>
                            body { font-family: 'Helvetica', 'Arial', sans-serif; margin: 0; padding: 0; color: #333; }
                            .header { background-color: #1e4a7a; color: white; padding: 40px 20px; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                            .header h1 { margin: 0; font-size: 24px; font-weight: bold; }
                            .header h2 { margin: 5px 0 0; font-size: 16px; font-weight: normal; opacity: 0.9; }
                            .meta-info { display: flex; justify-content: space-between; padding: 20px 40px; border-bottom: 2px solid #f0f0f0; font-size: 14px; color: #666; }
                            .content { padding: 40px; }
                            table { w-full; width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
                            th { background-color: #f8fafc; color: #475569; font-weight: bold; text-align: left; padding: 12px 15px; border-bottom: 2px solid #e2e8f0; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; -webkit-print-color-adjust: exact; }
                            td { padding: 12px 15px; border-bottom: 1px solid #e2e8f0; color: #1f2937; }
                            tr:nth-child(even) { background-color: #f8fafc; -webkit-print-color-adjust: exact; }
                            .footer { position: fixed; bottom: 0; left: 0; width: 100%; padding: 15px 40px; background: white; font-size: 10px; color: #999; border-top: 1px solid #eee; display: flex; justify-content: space-between; }
                            
                            @media print {
                                body { -webkit-print-color-adjust: exact; }
                                .no-print { display: none; }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>MIT Meerut</h1>
                            <h2>Problems Bank Report</h2>
                        </div>

                        <div class="meta-info">
                            <div>
                                <strong>Department:</strong> CSE<br>
                                <strong>HOD:</strong> Dr. Vishnu Gupta
                            </div>
                            <div style="text-align: right;">
                                <strong>Date:</strong> ${reportDate}<br>
                                <strong>Total Records:</strong> ${dataToExport.length}
                            </div>
                        </div>

                        <div class="content">
                            <table>
                                <thead>
                                    <tr>
                                        ${activeCols.map(c => `<th>${c.label}</th>`).join('')}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${dataToExport.map(row => `
                                        <tr>
                                            ${activeCols.map(c => `<td>${row[c.id]}</td>`).join('')}
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>

                        <div class="footer">
                            <span>Generated by CampusCode LMS</span>
                            <span>Page 1 of 1</span>
                        </div>

                        <script>
                            window.onload = function() { window.print(); }
                        </script>
                    </body>
                    </html>
                `;

                printWindow.document.write(htmlContent);
                printWindow.document.close();
            });
        }
    }

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
            // Create gradient
            const gradientPerformance = ctxPerformance.getContext('2d').createLinearGradient(0, 0, 0, 400);
            gradientPerformance.addColorStop(0, '#3b82f6');
            gradientPerformance.addColorStop(1, '#1d4ed8');

            new Chart(ctxPerformance, {
                type: 'bar',
                data: {
                    labels: ['Excellent', 'Good', 'Average', 'Needs Imp.'],
                    datasets: [{
                        label: 'Students',
                        data: [65, 80, 55, 20],
                        backgroundColor: gradientPerformance,
                        hoverBackgroundColor: '#2563eb',
                        borderRadius: 8,
                        borderSkipped: false,
                        maxBarThickness: 40
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#1f2937',
                            padding: 12,
                            titleFont: { size: 13 },
                            bodyFont: { size: 12 },
                            cornerRadius: 8,
                            displayColors: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(107, 114, 128, 0.05)',
                                borderDash: [5, 5]
                            },
                            border: { display: false }
                        },
                        x: {
                            grid: { display: false },
                            border: { display: false }
                        }
                    },
                    animation: {
                        duration: 2000,
                        easing: 'easeOutQuart'
                    }
                }
            });

            const btnDownloadReport = document.getElementById('btn-download-contest-report');
            if (btnDownloadReport) {
                btnDownloadReport.addEventListener('click', async () => {
                    const { jsPDF } = window.jspdf;
                    const doc = new jsPDF();

                    // Mock Data
                    const reportData = {
                        collegeName: "MIT Meerut",
                        contestTitle: "Weekly Coding Challenge #41",
                        dateTime: "2024-10-25 14:00 PM",
                        teacherName: "Dr. Vishnu Gupta",
                        subject: "Data Structures & Algorithms",
                        participants: 145,
                        averageScore: 78.5,
                        highestScore: 100,
                        difficulty: "Medium",
                        topStudents: [
                            { rank: 1, name: "Sagar Kumar", id: "2302920100126", score: 100, time: "45m" },
                            { rank: 2, name: "Priya Sharma", id: "2302920100127", score: 95, time: "50m" },
                            { rank: 3, name: "Rahul Verma", id: "2302920100128", score: 90, time: "55m" },
                            { rank: 4, name: "Anjali Gupta", id: "2302920100129", score: 88, time: "1h 05m" },
                            { rank: 5, name: "Amit Singh", id: "2302920100130", score: 85, time: "1h 10m" },
                            { rank: 6, name: "Sneha Patel", id: "2302920100131", score: 82, time: "1h 15m" },
                            { rank: 7, name: "Vikram Rao", id: "2302920100132", score: 80, time: "1h 20m" },
                            { rank: 8, name: "Neha Jain", id: "2302920100133", score: 78, time: "1h 25m" },
                            { rank: 9, name: "Rohan Das", id: "2302920100134", score: 75, time: "1h 30m" },
                            { rank: 10, name: "Kavita Roy", id: "2302920100135", score: 72, time: "1h 35m" },
                        ]
                    };

                    // Colors
                    const colorPrimary = [41, 128, 185]; // #2980b9
                    const colorSecondary = [52, 152, 219]; // #3498db
                    const colorBg = [245, 247, 250]; // #f5f7fa

                    // Draw Blue Header Background
                    doc.setFillColor(...colorPrimary);
                    doc.rect(0, 0, 210, 40, 'F');

                    // College Name (White)
                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(24);
                    doc.setTextColor(255, 255, 255);
                    doc.text(reportData.collegeName, 105, 18, { align: "center" });

                    // Report Title (White, smaller)
                    doc.setFont("helvetica", "normal");
                    doc.setFontSize(14);
                    doc.text("Contest Performance Analysis Report", 105, 28, { align: "center" });

                    let startY = 50;
                    const cardWidth = 45;
                    const cardHeight = 25;
                    const cardGap = 5;
                    const startX = 14;

                    // Function to draw metric card
                    const drawCard = (x, title, value) => {
                        doc.setFillColor(...colorBg);
                        doc.setDrawColor(220, 220, 220);
                        doc.roundedRect(x, startY, cardWidth, cardHeight, 3, 3, 'FD');

                        doc.setFontSize(9);
                        doc.setTextColor(100);
                        doc.text(title, x + cardWidth / 2, startY + 8, { align: "center" });

                        doc.setFontSize(14);
                        doc.setTextColor(50);
                        doc.setFont("helvetica", "bold");
                        doc.text(value.toString(), x + cardWidth / 2, startY + 18, { align: "center" });
                    };

                    drawCard(startX, "Participants", reportData.participants);
                    drawCard(startX + cardWidth + cardGap, "Average Score", reportData.averageScore);
                    drawCard(startX + (cardWidth + cardGap) * 2, "Highest Score", reportData.highestScore);
                    drawCard(startX + (cardWidth + cardGap) * 3, "Difficulty", reportData.difficulty);

                    startY += cardHeight + 15;

                    doc.setFontSize(12);
                    doc.setTextColor(33);
                    doc.text("Contest Details", 14, startY);
                    doc.setDrawColor(41, 128, 185);
                    doc.line(14, startY + 2, 45, startY + 2); // Underline "Contest Details"

                    startY += 10;
                    doc.setFontSize(11);
                    doc.setFont("helvetica", "normal");
                    doc.text(`Title: ${reportData.contestTitle}`, 14, startY);
                    doc.text(`Subject: ${reportData.subject}`, 110, startY);
                    startY += 7;
                    doc.text(`Date: ${reportData.dateTime}`, 14, startY);
                    doc.text(`Faculty: ${reportData.teacherName}`, 110, startY);

                    startY += 15;

                    doc.setFontSize(12);
                    doc.setFont("helvetica", "bold");
                    doc.text("Performance Analytics", 14, startY);
                    doc.setDrawColor(41, 128, 185);
                    doc.line(14, startY + 2, 55, startY + 2);

                    const chartCanvas = document.getElementById('performanceChart');
                    if (chartCanvas) {
                        // Add a light background for chart area
                        doc.setFillColor(...colorBg);
                        doc.roundedRect(14, startY + 5, 180, 85, 3, 3, 'F');

                        const chartImg = chartCanvas.toDataURL('image/png', 1.0);
                        doc.addImage(chartImg, 'PNG', 24, startY + 10, 160, 75);
                        startY += 100;
                    } else {
                        startY += 40;
                        doc.text("(Chart data unavailable)", 105, startY, { align: 'center' });
                        startY += 20;
                    }

                    doc.setFontSize(12);
                    doc.setFont("helvetica", "bold");
                    doc.setTextColor(33);
                    doc.text("Top 10 Performers", 14, startY);
                    doc.setDrawColor(41, 128, 185);
                    doc.line(14, startY + 2, 50, startY + 2);
                    startY += 8;

                    doc.autoTable({
                        startY: startY,
                        head: [['Rank', 'Student Name', 'ID', 'Score', 'Time Taken']],
                        body: reportData.topStudents.map(s => [s.rank.toString(), s.name, s.id, s.score.toString(), s.time]),
                        headStyles: {
                            fillColor: colorPrimary,
                            textColor: 255,
                            fontSize: 10,
                            halign: 'center'
                        },
                        bodyStyles: {
                            textColor: 50,
                            fontSize: 10,
                            halign: 'center'
                        },
                        alternateRowStyles: { fillColor: [240, 248, 255] },
                        columnStyles: {
                            1: { halign: 'left' } // Align Names to left
                        },
                        margin: { top: 10 }
                    });

                    const pageCount = doc.internal.getNumberOfPages();
                    const dateStr = new Date().toLocaleDateString();
                    for (let i = 1; i <= pageCount; i++) {
                        doc.setPage(i);

                        // Footer Bar
                        doc.setFillColor(245, 245, 245);
                        doc.rect(0, 280, 210, 17, 'F');

                        doc.setFontSize(9);
                        doc.setTextColor(150);
                        doc.text(`Generated on ${dateStr} | CampusCode LMS`, 14, 290);
                        doc.text(`Page ${i} of ${pageCount}`, 196, 290, { align: 'right' });
                    }

                    // Save PDF
                    doc.save('Contest_Report_Enhanced.pdf');
                });
            }

            const btnDashboardReports = document.getElementById('btn-dashboard-reports');
            if (btnDashboardReports) {
                btnDashboardReports.addEventListener('click', async () => {
                    const { jsPDF } = window.jspdf;
                    const doc = new jsPDF();

                    // Report Data (Aggregated)
                    const collegeName = "MIT Meerut";
                    const generatedDate = new Date().toLocaleString();
                    const reportTitle = "Comprehensive Dashboard Report";

                    // Mock Dashboard Stats
                    const stats = [
                        { label: "Total Students", value: "1,200" },
                        { label: "Total Faculty", value: "48" },
                        { label: "Active Contests", value: "5" },
                        { label: "Total Problems", value: "350" }
                    ];

                    // Mock Created Problems Data (Usually fetched)
                    const createdProblems = [
                        { title: "Custom Graph Problem", subject: "DSA", difficulty: "Hard", created: "2024-10-20" },
                        { title: "Binary Search - Edge Cases", subject: "DSA", difficulty: "Medium", created: "2024-10-22" },
                        { title: "SQL Optimization", subject: "DBMS", difficulty: "Medium", created: "2024-10-18" },
                        { title: "Process Scheduling", subject: "OS", difficulty: "Easy", created: "2024-10-15" },
                        { title: "React State Management", subject: "Web Dev", difficulty: "Hard", created: "2024-10-10" }
                    ];

                    // Colors
                    const colorPrimary = [32, 178, 170]; // Teal (Light Sea Green)
                    const colorBg = [240, 255, 255]; // Azure

                    doc.setFillColor(...colorPrimary);
                    doc.rect(0, 0, 210, 40, 'F');

                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(22);
                    doc.setTextColor(255, 255, 255);
                    doc.text(collegeName, 105, 18, { align: "center" });

                    doc.setFontSize(14);
                    doc.setFont("helvetica", "normal");
                    doc.text(reportTitle, 105, 30, { align: "center" });

                    let startY = 45;

                    doc.setFontSize(14);
                    doc.setTextColor(33);
                    doc.setFont("helvetica", "bold");
                    doc.text("Overall Statistics", 14, startY);
                    doc.setDrawColor(32, 178, 170);
                    doc.setLineWidth(0.5);
                    doc.line(14, startY + 2, 60, startY + 2);
                    startY += 10;

                    // Draw Stat Cards (Simulated)
                    const cardWidth = 40;
                    const cardHeight = 25;
                    const gap = 6;

                    stats.forEach((stat, index) => {
                        const x = 14 + index * (cardWidth + gap);
                        doc.setFillColor(250, 250, 250);
                        doc.setDrawColor(220);
                        doc.roundedRect(x, startY, cardWidth, cardHeight, 3, 3, 'FD');

                        doc.setFontSize(8);
                        doc.setTextColor(100);
                        doc.text(stat.label, x + cardWidth / 2, startY + 10, { align: "center" });

                        doc.setFontSize(12);
                        doc.setTextColor(33);
                        doc.setFont("helvetica", "bold");
                        doc.text(stat.value, x + cardWidth / 2, startY + 18, { align: "center" });
                    });

                    startY += cardHeight + 15;

                    doc.setFontSize(14);
                    doc.setTextColor(33);
                    doc.setFont("helvetica", "bold");
                    doc.text("Created Problems Overview", 14, startY);
                    doc.line(14, startY + 2, 85, startY + 2);
                    startY += 8;

                    doc.autoTable({
                        startY: startY,
                        head: [['Problem Title', 'Subject', 'Difficulty', 'Created Date']],
                        body: createdProblems.map(p => [p.title, p.subject, p.difficulty, p.created]),
                        headStyles: {
                            fillColor: colorPrimary,
                            textColor: 255,
                            fontSize: 10,
                            halign: 'left'
                        },
                        bodyStyles: {
                            textColor: 50,
                            fontSize: 10,
                            halign: 'left'
                        },
                        alternateRowStyles: { fillColor: [245, 255, 250] }, // Mint Cream
                        margin: { top: 10 }
                    });

                    // We'll capture the chart from the dashboard if visible
                    let finalY = doc.lastAutoTable.finalY + 15;

                    doc.setFontSize(14);
                    doc.setTextColor(33);
                    doc.setFont("helvetica", "bold");
                    doc.text("Performance Analytics", 14, finalY);
                    doc.line(14, finalY + 2, 70, finalY + 2);
                    finalY += 10;

                    const chartCanvas = document.getElementById('performanceChart');
                    if (chartCanvas) {
                        const chartImg = chartCanvas.toDataURL('image/png', 1.0);
                        doc.addImage(chartImg, 'PNG', 14, finalY, 180, 80);
                    } else {
                        doc.setFontSize(10);
                        doc.setTextColor(150);
                        doc.text("(Analytics Chart snapshot not available)", 14, finalY + 10);
                    }

                    // FOOTER
                    const pageCount = doc.internal.getNumberOfPages();
                    for (let i = 1; i <= pageCount; i++) {
                        doc.setPage(i);

                        // Footer Bar
                        doc.setFillColor(245, 245, 245);
                        doc.rect(0, 280, 210, 17, 'F');

                        doc.setFont("helvetica", "normal");
                        doc.setFontSize(9);
                        doc.setTextColor(150);
                        doc.text(`Generated on ${generatedDate} | CampusCode LMS`, 14, 290);
                        doc.text(`Page ${i} of ${pageCount}`, 196, 290, { align: 'right' });
                    }

                    doc.save('CampusCode_Comprehensive_Report.pdf');
                });
            }

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

    if (typeof Quill !== 'undefined' && document.getElementById('editor-container')) {
        new Quill('#editor-container', {
            theme: 'snow',
            placeholder: 'Describe the problem...',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['blockquote', 'code-block'],
                    [{ 'color': [] }, { 'background': [] }],
                    ['clean']
                ]
            }
        });
    }

    const btnAddStudent = document.getElementById('btn-add-student');
    const studentsListView = document.getElementById('students-list-view');
    const studentFormView = document.getElementById('student-form-view');
    const btnBackToStudentList = document.getElementById('btn-back-to-student-list');
    const btnCancelAddStudent = document.getElementById('btn-cancel-add-student');

    if (btnAddStudent && studentsListView && studentFormView) {
        btnAddStudent.addEventListener('click', () => {
            studentsListView.classList.add('hidden');
            studentFormView.classList.remove('hidden');
        });
    }

    if (btnBackToStudentList) {
        btnBackToStudentList.addEventListener('click', () => {
            studentFormView.classList.add('hidden');
            studentsListView.classList.remove('hidden');
        });
    }

    if (btnCancelAddStudent) {
        btnCancelAddStudent.addEventListener('click', () => {
            studentFormView.classList.add('hidden');
            studentsListView.classList.remove('hidden');
        });
    }

    const btnNewPost = document.getElementById('newPostBtn');
    const forumListView = document.getElementById('forum-list-view');
    const forumPostForm = document.getElementById('forum-post-form');
    const btnCancelPost = document.getElementById('btn-cancel-post');
    const btnBackToForum = document.getElementById('btn-back-to-forum');
    const newDiscussionForm = document.getElementById('new-discussion-form');

    if (btnNewPost && forumListView && forumPostForm) {
        // Show Form
        btnNewPost.addEventListener('click', () => {
            forumListView.classList.add('hidden');
            forumPostForm.classList.remove('hidden');
        });

        // Hide Form (Cancel / Back)
        const hideForm = () => {
            forumPostForm.classList.add('hidden');
            forumListView.classList.remove('hidden');
            if (newDiscussionForm) newDiscussionForm.reset(); // Reset form on cancel
        };

        if (btnCancelPost) btnCancelPost.addEventListener('click', hideForm);
        if (btnBackToForum) btnBackToForum.addEventListener('click', hideForm);

        // Simulated Submission
        if (newDiscussionForm) {
            newDiscussionForm.addEventListener('submit', (e) => {
                e.preventDefault();

                // Get values (for potential future use or validation)
                const title = document.getElementById('post-title').value;
                const category = document.getElementById('post-category').value;

                if (title && category) {
                    // Simulate API call/processing
                    setTimeout(() => {
                        alert('Discussion posted successfully!');
                        hideForm();
                    }, 500);
                }
            });
        }
    }

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            window.location.href = 'dashboard.html';
        });
    }

    // Call init
    try {
        initDashboardCharts();
    } catch (error) {
    }

    // Force Dashboard View on Load (safe even if helper is missing)
    if (typeof window.showSection === 'function') {
        window.showSection('section-dashboard');
    } else {
        const dashboardSection = document.getElementById('section-dashboard');
        if (dashboardSection) {
            document.querySelectorAll('.content-section').forEach((sec) => sec.classList.add('hidden'));
            dashboardSection.classList.remove('hidden');
        }
    }

});

/* --- Reports Section Logic --- */
var reportData = window.__hosReportData || (window.__hosReportData = {
    Students: {
        headers: ["Name", "ID", "Program", "Year", "Branch", "Score"],
        rows: [
            ["Arjun Mehta", "CS01", "B.Tech", "3rd", "CSE", "920"],
            ["Sara Khan", "CS02", "B.Tech", "2nd", "IT", "850"],
            ["Liam Smith", "CS03", "B.E", "4th", "ME", "740"],
            ["Priya Das", "CS04", "M.Tech", "1st", "CSE", "980"]
        ],
        config: { format: 'XLSX', color: 'bg-emerald-500' }
    },
    Contests: {
        headers: ["Contest Title", "Date", "Subject", "Participants", "Status"],
        rows: [
            ["Weekly Sprint #88", "Dec 20", "Data Structures", "1,240", "Live"],
            ["Algorithm Master", "Dec 12", "Algorithms", "850", "Past"],
            ["Logic Lab", "Jan 05", "Discrete Math", "400", "Upcoming"]
        ],
        config: { format: 'PDF', color: 'bg-rose-500' }
    },
    Problems: {
        headers: ["Problem", "Topic", "Language", "Difficulty", "Bookmark"],
        rows: [
            ["Two Sum", "Arrays", "C++", "Easy", "Yes"],
            ["Merge Sort", "Sorting", "Java", "Medium", "No"],
            ["Graph DFS", "Graphs", "Python", "Hard", "Yes"]
        ],
        config: { format: 'XLSX', color: 'bg-blue-500' }
    }
});

window.initReportUI = function () {
    const type = document.getElementById('reportType').value;
    const container = document.getElementById('filterContainer');
    const btn = document.getElementById('actionBtn');
    const badge = document.getElementById('formatBadge');
    const title = document.getElementById('previewTitle');

    if (!container || !btn || !badge || !title) return;

    // 1. Setup Filters
    container.innerHTML = '<p class="text-[10px] font-bold text-gray-400 uppercase mb-2">Sections to Include</p>';
    reportData[type].headers.forEach((h, i) => {
        const label = document.createElement('label');
        label.className = "flex items-center gap-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg cursor-pointer transition-all";
        label.innerHTML = `
            <input type="checkbox" checked data-index="${i}" class="col-toggle w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500">
            <span class="text-xs font-medium text-gray-600 dark:text-gray-300">${h}</span>
        `;
        label.querySelector('input').addEventListener('change', window.syncReportTable);
        container.appendChild(label);
    });

    // 2. Setup Action Button
    btn.className = `w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${reportData[type].config.color}`;
    btn.innerHTML = `<i class="fas ${reportData[type].config.format === 'PDF' ? 'fa-file-pdf' : 'fa-file-excel'}"></i> Download ${reportData[type].config.format}`;

    badge.innerText = reportData[type].config.format;
    title.innerText = `${type} Report`;

    window.syncReportTable();
}

window.syncReportTable = function () {
    const type = document.getElementById('reportType').value;
    const tableDiv = document.getElementById('previewTableContainer');
    const activeIndices = Array.from(document.querySelectorAll('.col-toggle'))
        .filter(i => i.checked)
        .map(i => parseInt(i.dataset.index));

    if (!tableDiv) return;

    if (activeIndices.length === 0) {
        tableDiv.innerHTML = '<div class="py-20 text-center text-gray-400 italic">No columns selected</div>';
        return;
    }

    let html = `<table class="report-table"><thead><tr>`;
    activeIndices.forEach(i => html += `<th>${reportData[type].headers[i]}</th>`);
    html += `</tr></thead><tbody>`;

    reportData[type].rows.forEach(row => {
        html += `<tr>`;
        activeIndices.forEach(i => html += `<td>${row[i]}</td>`);
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    tableDiv.innerHTML = html;
}

window.handleReportDownload = function () {
    const type = document.getElementById('reportType').value;
    const activeIndices = Array.from(document.querySelectorAll('.col-toggle'))
        .filter(i => i.checked)
        .map(i => parseInt(i.dataset.index));

    // Extract filtered data
    const filteredHeaders = activeIndices.map(i => reportData[type].headers[i]);
    const filteredRows = reportData[type].rows.map(row => activeIndices.map(i => row[i]));
    const exportData = [filteredHeaders, ...filteredRows];

    if (reportData[type].config.format === 'PDF') {
        const element = document.getElementById('report-content');
        if (typeof html2pdf !== 'undefined') {
            html2pdf().set({
                margin: 10,
                filename: `CampusCode_${type}_Report.pdf`,
                html2canvas: { scale: 3 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            }).from(element).save();
        } else {
            alert('PDF library not loaded.');
        }
    } else {
        if (typeof XLSX !== 'undefined') {
            const ws = XLSX.utils.aoa_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Report");
            XLSX.writeFile(wb, `CampusCode_${type}_Report.xlsx`);
        } else {
            alert('Excel library not loaded.');
        }
    }
}

// Initialize Reports when DOM is ready (in case accessing directly)
document.addEventListener("DOMContentLoaded", function () {
    if (document.getElementById('section-reports')) {
        const dateElem = document.getElementById('currentDate');
        if (dateElem) dateElem.innerText = new Date().toLocaleDateString('en-GB');
        window.initReportUI();
    }
});

var btnExportProblems = document.getElementById('btn-export-problem-report'); // Placeholder if button exists
var exportProblemsModal = document.getElementById('exportProblemsModal');
var closeProblemsModalBtn = document.getElementById('closeProblemsModal');
var probTableBody = document.getElementById('probTableBody');
var probTableHeadRow = document.getElementById('probTableHeadRow');
var probColumnSelectionList = document.getElementById('probColumnSelectionList');
var selectAllProbColumnsBtn = document.getElementById('selectAllProbColumns');
var probSearchInput = document.getElementById('probSearchInput');
var probFilterSubject = document.getElementById('probFilterSubject');
var probFilterDifficulty = document.getElementById('probFilterDifficulty');
var probPreviewCount = document.getElementById('probPreviewCount');
var btnDownloadProblemsPDF = document.getElementById('btnDownloadProblemsPDF');

var allProbData = [];
var displayedProbData = [];

var probExportColumns = [
    { id: 'title', label: 'Title', selected: true },
    { id: 'subject', label: 'Subject', selected: true },
    { id: 'difficulty', label: 'Difficulty', selected: true },
    { id: 'tags', label: 'Tags', selected: true },
    { id: 'status', label: 'Status', selected: true },
    { id: 'attempts', label: 'Attempts', selected: false },
    { id: 'success_rate', label: 'Success Rate', selected: false },
    { id: 'created_at', label: 'Created At', selected: false }
];

if (exportProblemsModal) {

    const openProblemsExportModal = () => {
        scrapeAndMockProblemData();
        renderProbColumnSelection();
        populateProbFilters(); // Reuse or create specific mock filters
        applyProbFiltersAndRender();
        exportProblemsModal.classList.remove('hidden');
    };

    // Dropdown Trigger (Report Page)
    const reportDropdownRef = document.getElementById('reportTypeDropdown');
    if (reportDropdownRef) {
        reportDropdownRef.addEventListener('change', (e) => {
            if (e.target.value === "Problem Report") {
                openProblemsExportModal();
                e.target.value = ""; // Reset
            }
        });
    }

    if (closeProblemsModalBtn) {
        closeProblemsModalBtn.addEventListener('click', () => {
            exportProblemsModal.classList.add('hidden');
        });
    }

    function scrapeAndMockProblemData() {
        // Mock Data Generator for Report Page (since table might not exist or be complete)
        const subjects = ["Data Structures", "Algorithms", "DBMS", "OS", "CN", "AI"];
        const difficulties = ["Easy", "Medium", "Hard"];
        const tagsPool = ["Arrays", "DP", "Graphs", "Trees", "Sorting", "Searching", "Recursion", "Greedy"];
        const statuses = ["Active", "Archived", "Draft"];

        allProbData = Array.from({ length: 20 }).map((_, index) => {
            const title = `Problem ${index + 1}: ${tagsPool[index % tagsPool.length]} Challenge`;
            const subject = subjects[index % subjects.length];
            const difficulty = difficulties[index % difficulties.length];

            // Random date in last year
            const date = new Date();
            date.setDate(date.getDate() - Math.floor(Math.random() * 365));

            return {
                title: title,
                subject: subject,
                difficulty: difficulty,
                tags: [tagsPool[index % tagsPool.length], tagsPool[(index + 1) % tagsPool.length]].join(", "),
                status: statuses[index % statuses.length],
                attempts: Math.floor(Math.random() * 500),
                success_rate: (Math.random() * 100).toFixed(1) + "%",
                created_at: date.toISOString().split('T')[0]
            };
        });
    }

    function renderProbColumnSelection() {
        if (!probColumnSelectionList) return;
        probColumnSelectionList.innerHTML = '';
        probExportColumns.forEach(col => {
            const div = document.createElement('div');
            div.className = "flex items-center space-x-2";
            div.innerHTML = `
                    <input type="checkbox" id="col_${col.id}" ${col.selected ? 'checked' : ''} class="rounded text-primary-600 focus:ring-primary-500">
                    <label for="col_${col.id}" class="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">${col.label}</label>
                `;
            div.querySelector('input').addEventListener('change', (e) => {
                col.selected = e.target.checked;
                applyProbFiltersAndRender();
            });
            probColumnSelectionList.appendChild(div);
        });
    }

    if (selectAllProbColumnsBtn) {
        selectAllProbColumnsBtn.addEventListener('click', () => {
            const allSelected = probExportColumns.every(c => c.selected);
            probExportColumns.forEach(c => c.selected = !allSelected);
            renderProbColumnSelection();
            applyProbFiltersAndRender();
        });
    }

    function populateProbFilters() {
        // Populate Subjects (Unique from data)
        if (probFilterSubject && allProbData.length > 0) {
            const subjects = [...new Set(allProbData.map(d => d.subject))].sort();
            probFilterSubject.innerHTML = `<option value="all">Subject: All</option>`;
            subjects.forEach(s => {
                probFilterSubject.innerHTML += `<option value="${s}">${s}</option>`;
            });
        }
    }

    function applyProbFiltersAndRender() {
        let filtered = [...allProbData];

        // Search
        const term = probSearchInput && probSearchInput.value.toLowerCase();
        if (term) {
            filtered = filtered.filter(p =>
                p.title.toLowerCase().includes(term) ||
                p.tags.toLowerCase().includes(term)
            );
        }

        // Subject Filter
        if (probFilterSubject && probFilterSubject.value !== 'all') {
            filtered = filtered.filter(p => p.subject === probFilterSubject.value);
        }

        // Difficulty Filter
        if (probFilterDifficulty && probFilterDifficulty.value !== 'all') {
            filtered = filtered.filter(p => p.difficulty === probFilterDifficulty.value);
        }

        displayedProbData = filtered;
        renderProbPreviewTable();
    }

    if (probSearchInput) probSearchInput.addEventListener('input', applyProbFiltersAndRender);
    if (probFilterSubject) probFilterSubject.addEventListener('change', applyProbFiltersAndRender);
    if (probFilterDifficulty) probFilterDifficulty.addEventListener('change', applyProbFiltersAndRender);


    function renderProbPreviewTable() {
        if (!probTableHeadRow || !probTableBody) return;

        // Headers
        const activeCols = probExportColumns.filter(c => c.selected);
        probTableHeadRow.innerHTML = activeCols.map(c => `<th class="px-6 py-3">${c.label}</th>`).join('');

        // Body
        probTableBody.innerHTML = displayedProbData.map(row => `
                <tr class="bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    ${activeCols.map(c => `<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${row[c.id]}</td>`).join('')}
                </tr>
            `).join('');

        if (probPreviewCount) probPreviewCount.textContent = displayedProbData.length;
    }

    // Print Functionality
    if (btnDownloadProblemsPDF) {
        btnDownloadProblemsPDF.addEventListener('click', () => {
            const activeCols = probExportColumns.filter(c => c.selected);
            // Simple Print Window logic (reusing similar logic from faculty/student)
            const printWindow = window.open('', '', 'height=600,width=800');
            printWindow.document.write('<html><head><title>Problem Report</title>');
            printWindow.document.write('<style>table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid black; padding: 8px; text-align: left; } h1 { text-align: center; }</style>');
            printWindow.document.write('</head><body>');
            printWindow.document.write('<h1>Problem Report</h1>');
            printWindow.document.write('<table><thead><tr>');
            activeCols.forEach(c => printWindow.document.write(`<th>${c.label}</th>`));
            printWindow.document.write('</tr></thead><tbody>');
            displayedProbData.forEach(row => {
                printWindow.document.write('<tr>');
                activeCols.forEach(c => printWindow.document.write(`<td>${row[c.id]}</td>`));
                printWindow.document.write('</tr>');
            });
            printWindow.document.write('</tbody></table>');
            printWindow.document.write('</body></html>');
            printWindow.document.close();
            printWindow.print();
        });
    }
}

var exportContestModal = document.getElementById('exportContestModal');
var closeContestModalBtn = document.getElementById('closeContestModal');
var contestTableBody = document.getElementById('contestTableBody');
var contestTableHeadRow = document.getElementById('contestTableHeadRow');
var contestColumnSelectionList = document.getElementById('contestColumnSelectionList');
var selectAllContestColumnsBtn = document.getElementById('selectAllContestColumns');
var contestSearchInput = document.getElementById('contestSearchInput');
var contestFilterSubject = document.getElementById('contestFilterSubject');
var contestStartDate = document.getElementById('contestStartDate');
var contestEndDate = document.getElementById('contestEndDate');
var contestSortSelect = document.getElementById('contestSortSelect');
var contestPreviewCount = document.getElementById('contestPreviewCount');
var btnDownloadContestPDF = document.getElementById('btnDownloadContestPDF');

var allContestData = [];
var displayedContestData = [];

var contestExportColumns = [
    { id: 'title', label: 'Title', selected: true },
    { id: 'subject', label: 'Subject', selected: true },
    { id: 'teacher', label: 'Teacher', selected: true },
    { id: 'date', label: 'Date', selected: true },
    { id: 'ques_count', label: 'No. of Ques', selected: false },
    { id: 'duration', label: 'Timing', selected: false },
    { id: 'year', label: 'Year', selected: false },
    { id: 'section', label: 'Section', selected: false },
    { id: 'participants', label: 'No. of Students', selected: true },
    { id: 'participation_pct', label: 'Participation %', selected: true },
    { id: 'avg_marks', label: 'Avg Marks', selected: true }
];

if (exportContestModal) {

    const openContestExportModal = () => {
        scrapeAndMockContestData();
        renderContestColumnSelection();
        populateContestFilters();
        applyContestFiltersAndRender();
        exportContestModal.classList.remove('hidden');
    };

    // Reuse report dropdown listener if it exists, logic appended to it effectively via separate listener or checking value
    const reportDropdownRef = document.getElementById('reportTypeDropdown');
    if (reportDropdownRef) {
        reportDropdownRef.addEventListener('change', (e) => {
            if (e.target.value === "Contest Report") {
                openContestExportModal();
                e.target.value = "";
            }
        });
    }

    if (closeContestModalBtn) {
        closeContestModalBtn.addEventListener('click', () => {
            exportContestModal.classList.add('hidden');
        });
    }

    function scrapeAndMockContestData() {
        const subjects = ["Data Structures", "Algorithms", "DBMS", "OS", "CN", "AI", "Software Eng"];
        const teachers = ["Dr. Smith", "Prof. Johnson", "Ms. Davis", "Mr. Wilson", "Dr. Brown"];
        const years = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
        const sections = ["A", "B", "C", "D"];

        allContestData = Array.from({ length: 25 }).map((_, index) => {
            const subject = subjects[index % subjects.length];

            // Random date in last 6 months
            const date = new Date();
            date.setDate(date.getDate() - Math.floor(Math.random() * 180));

            const participants = Math.floor(Math.random() * 150) + 20;
            const totalStudents = 180; // approximate class size
            const participationPct = ((participants / totalStudents) * 100).toFixed(1) + "%";

            return {
                title: `Contest ${index + 1}: ${subject} Assessment`,
                subject: subject,
                teacher: teachers[index % teachers.length],
                date: date.toISOString().split('T')[0],
                ques_count: Math.floor(Math.random() * 10) + 5, // 5-15 questions
                duration: [60, 90, 120, 180][Math.floor(Math.random() * 4)] + " mins",
                year: years[index % years.length],
                section: sections[index % sections.length],
                participants: participants,
                participation_pct: participationPct,
                avg_marks: (Math.random() * 40 + 60).toFixed(1) // 60-100 avg
            };
        });
    }

    function renderContestColumnSelection() {
        if (!contestColumnSelectionList) return;
        contestColumnSelectionList.innerHTML = '';
        contestExportColumns.forEach(col => {
            const div = document.createElement('div');
            div.className = "flex items-center space-x-2";
            div.innerHTML = `
                    <input type="checkbox" id="col_con_${col.id}" ${col.selected ? 'checked' : ''} class="rounded text-primary-600 focus:ring-primary-500">
                    <label for="col_con_${col.id}" class="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">${col.label}</label>
                `;
            div.querySelector('input').addEventListener('change', (e) => {
                col.selected = e.target.checked;
                applyContestFiltersAndRender();
            });
            contestColumnSelectionList.appendChild(div);
        });
    }

    if (selectAllContestColumnsBtn) {
        selectAllContestColumnsBtn.addEventListener('click', () => {
            const allSelected = contestExportColumns.every(c => c.selected);
            contestExportColumns.forEach(c => c.selected = !allSelected);
            renderContestColumnSelection();
            applyContestFiltersAndRender();
        });
    }

    function populateContestFilters() {
        if (contestFilterSubject && allContestData.length > 0) {
            const subjects = [...new Set(allContestData.map(d => d.subject))].sort();
            contestFilterSubject.innerHTML = `<option value="all">Subject: All</option>`;
            subjects.forEach(s => {
                contestFilterSubject.innerHTML += `<option value="${s}">${s}</option>`;
            });
        }
    }

    function applyContestFiltersAndRender() {
        let filtered = [...allContestData];

        // Search
        const term = contestSearchInput && contestSearchInput.value.toLowerCase();
        if (term) {
            filtered = filtered.filter(p =>
                p.title.toLowerCase().includes(term) ||
                p.teacher.toLowerCase().includes(term)
            );
        }

        // Subject Filter
        if (contestFilterSubject && contestFilterSubject.value !== 'all') {
            filtered = filtered.filter(p => p.subject === contestFilterSubject.value);
        }

        // Date Range Filter
        if (contestStartDate && contestStartDate.value) {
            filtered = filtered.filter(p => p.date >= contestStartDate.value);
        }
        if (contestEndDate && contestEndDate.value) {
            filtered = filtered.filter(p => p.date <= contestEndDate.value);
        }

        // Sorting
        if (contestSortSelect) {
            const sortVal = contestSortSelect.value;
            filtered.sort((a, b) => {
                if (sortVal === 'date_new') return new Date(b.date) - new Date(a.date);
                if (sortVal === 'date_old') return new Date(a.date) - new Date(b.date);
                if (sortVal === 'title_asc') return a.title.localeCompare(b.title);
                if (sortVal === 'participation_desc') return parseFloat(b.participation_pct) - parseFloat(a.participation_pct);
                return 0;
            });
        }

        displayedContestData = filtered;
        renderContestPreviewTable();
    }

    if (contestSearchInput) contestSearchInput.addEventListener('input', applyContestFiltersAndRender);
    if (contestFilterSubject) contestFilterSubject.addEventListener('change', applyContestFiltersAndRender);
    if (contestStartDate) contestStartDate.addEventListener('change', applyContestFiltersAndRender);
    if (contestEndDate) contestEndDate.addEventListener('change', applyContestFiltersAndRender);
    if (contestSortSelect) contestSortSelect.addEventListener('change', applyContestFiltersAndRender);


    function renderContestPreviewTable() {
        if (!contestTableHeadRow || !contestTableBody) return;

        // Headers
        const activeCols = contestExportColumns.filter(c => c.selected);
        contestTableHeadRow.innerHTML = activeCols.map(c => `<th class="px-6 py-3 whitespace-nowrap">${c.label}</th>`).join('');

        // Body
        contestTableBody.innerHTML = displayedContestData.map(row => `
                <tr class="bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    ${activeCols.map(c => `<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">${row[c.id]}</td>`).join('')}
                </tr>
            `).join('');

        if (contestPreviewCount) contestPreviewCount.textContent = displayedContestData.length;
    }

    // PDF Print Functionality (Past Contest Report)
    const btnDownloadContestReport = document.getElementById('btn-download-contest-report');
    if (btnDownloadContestReport) {
        btnDownloadContestReport.addEventListener('click', () => {
            const printWindow = window.open('', '', 'height=800,width=1200');

            // Dynamic Data (Mocked for now as per request)
            const contestTitle = "CodeSpace Weekly Challenge #42";
            const teacherName = "Prof. Alan Turing";
            const subject = "Data Structures & Algorithms";
            const dateTime = new Date().toLocaleString();

            const htmlContent = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Contest Analytics Dashboard</title>
                    <script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
                    <style>
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background-color: #f4f6f9;
                            margin: 0;
                            padding: 20px;
                        }
                        .header {
                            text-align: center;
                            margin-bottom: 30px;
                            color: #333;
                            border-bottom: 2px solid #ddd;
                            padding-bottom: 20px;
                        }
                        .meta-info {
                            display: flex;
                            justify-content: space-between;
                            max-width: 800px;
                            margin: 0 auto 30px auto;
                            background: white;
                            padding: 15px;
                            border-radius: 8px;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                            font-size: 0.9em;
                            color: #555;
                        }
                        .meta-item {
                            text-align: center;
                        }
                        .meta-label {
                            font-weight: bold;
                            display: block;
                            color: #888;
                            font-size: 0.8em;
                            text-transform: uppercase;
                            margin-bottom: 4px;
                        }
                        /* Grid Layout for Dashboard */
                        .dashboard-grid {
                            display: grid;
                            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
                            gap: 20px;
                            max-width: 1200px;
                            margin: 0 auto;
                        }
                        .card {
                            background: white;
                            padding: 20px;
                            border-radius: 10px;
                            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                        }
                        h3 {
                            margin-top: 0;
                            color: #555;
                            font-size: 1.1rem;
                            border-bottom: 2px solid #eee;
                            padding-bottom: 10px;
                        }
                        canvas {
                            max-height: 300px;
                        }
                    </style>
                </head>
                <body>

                    <div class="header">
                        <h1>CodeSpace Contest Analytics</h1>
                        <p>Post-Event Performance Overview</p>
                    </div>

                    <div class="meta-info">
                        <div class="meta-item">
                            <span class="meta-label">Contest Title</span>
                            <span>${contestTitle}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Subject</span>
                            <span>${subject}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Instructor</span>
                            <span>${teacherName}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Date & Time</span>
                            <span>${dateTime}</span>
                        </div>
                    </div>

                    <div class="dashboard-grid">
                        
                        <div class="card">
                            <h3>Submission Verdict Distribution</h3>
                            <canvas id="verdictChart"></canvas>
                            <p style="font-size: 0.9em; color: #666; margin-top: 10px;">
                                High TLE count indicates strict time limits.
                            </p>
                        </div>

                        <div class="card">
                            <h3>Submissions Volume (Per 15 Mins)</h3>
                            <canvas id="timeChart"></canvas>
                        </div>

                        <div class="card">
                            <h3>Language Popularity</h3>
                            <canvas id="languageChart"></canvas>
                        </div>

                        <div class="card">
                            <h3>Problem Accuracy (Success Rate)</h3>
                            <canvas id="accuracyChart"></canvas>
                        </div>

                    </div>

                    <script>
                        setTimeout(() => {
                            const ctxVerdict = document.getElementById('verdictChart').getContext('2d');
                            new Chart(ctxVerdict, {
                                type: 'doughnut',
                                data: {
                                    labels: ['Accepted (AC)', 'Wrong Answer (WA)', 'Time Limit (TLE)', 'Runtime Error (RE)'],
                                    datasets: [{
                                        data: [350, 400, 150, 50],
                                        backgroundColor: ['#4caf50', '#f44336', '#ff9800', '#9c27b0']
                                    }]
                                }
                            });

                            const ctxTime = document.getElementById('timeChart').getContext('2d');
                            new Chart(ctxTime, {
                                type: 'line',
                                data: {
                                    labels: ['0m', '15m', '30m', '45m', '60m', '75m', '90m'],
                                    datasets: [{
                                        label: 'Total Submissions',
                                        data: [20, 150, 200, 180, 250, 400, 600], // Shows panic spike at end
                                        borderColor: '#2196f3',
                                        backgroundColor: 'rgba(33, 150, 243, 0.2)',
                                        fill: true,
                                        tension: 0.4
                                    }]
                                },
                                options: {
                                    scales: { y: { beginAtZero: true } }
                                }
                            });

                            const ctxLang = document.getElementById('languageChart').getContext('2d');
                            new Chart(ctxLang, {
                                type: 'pie',
                                data: {
                                    labels: ['C++', 'Python', 'Java', 'JavaScript'],
                                    datasets: [{
                                        data: [55, 30, 10, 5],
                                        backgroundColor: ['#00599C', '#3776AB', '#f89820', '#f7df1e']
                                    }]
                                }
                            });

                            const ctxAcc = document.getElementById('accuracyChart').getContext('2d');
                            new Chart(ctxAcc, {
                                type: 'bar',
                                data: {
                                    labels: ['Problem A', 'Problem B', 'Problem C', 'Problem D'],
                                    datasets: [{
                                        label: 'Success Rate (%)',
                                        data: [85, 60, 45, 10], // Problem D is clearly the hardest
                                        backgroundColor: ['#81c784', '#64b5f6', '#ffb74d', '#e57373']
                                    }]
                                },
                                options: {
                                    scales: {
                                        y: { 
                                            beginAtZero: true,
                                            max: 100
                                        }
                                    }
                                }
                            });
                            
                            // Print after charts animation (approx)
                            setTimeout(() => window.print(), 1000);
                        }, 500);
                    <\/script>
                </body>
                </html>
            `;

            printWindow.document.write(htmlContent);
            printWindow.document.close();
        });
    }
}

// Auto-selection removed - reports page starts without pre-selected report

function initReportUI() {
    const type = document.getElementById('reportType').value;
    const title = document.getElementById('previewTitle');
    const badge = document.getElementById('formatBadge');
    const container = document.getElementById('filterContainer');
    const tableContainer = document.getElementById('previewTableContainer');

    // Update Date
    const dateEl = document.getElementById('currentDate');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString();

    if (type === 'Contests') {
        title.textContent = 'Contest Performance Analytics';
        badge.textContent = 'PDF REPORT';
        badge.className = 'px-3 py-1 bg-red-100 text-red-600 rounded-full text-[10px] font-bold uppercase';

        container.innerHTML = `
                <select class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2.5 text-xs bg-white dark:bg-gray-800 dark:text-gray-300">
                    <option>All Logic Building Contests</option>
                    <option>Weekly Challenges</option>
                    <option>Hackathons</option>
                </select>
                <div class="grid grid-cols-2 gap-2">
                    <input type="date" class="border border-gray-200 dark:border-gray-600 rounded-lg p-2.5 text-xs bg-white dark:bg-gray-800 dark:text-gray-300">
                    <input type="date" class="border border-gray-200 dark:border-gray-600 rounded-lg p-2.5 text-xs bg-white dark:bg-gray-800 dark:text-gray-300">
                </div>
            `;

        // Mock Contest Table
        tableContainer.innerHTML = `
                <table class="w-full text-left text-xs">
                    <thead class="bg-gray-50 dark:bg-gray-700/50 text-gray-400 font-bold uppercase">
                        <tr>
                            <th class="p-3">Contest Name</th>
                            <th class="p-3">Date</th>
                            <th class="p-3 text-center">Participants</th>
                            <th class="p-3 text-right">Avg Score</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50 dark:divide-gray-700">
                        <tr>
                            <td class="p-3 font-bold text-gray-700 dark:text-gray-200">Weekly Challenge #42</td>
                            <td class="p-3 text-gray-500">Oct 12, 2023</td>
                            <td class="p-3 text-center">1,245</td>
                            <td class="p-3 text-right font-bold text-green-600">76%</td>
                        </tr>
                        <tr>
                            <td class="p-3 font-bold text-gray-700 dark:text-gray-200">DSA Grand Contest</td>
                            <td class="p-3 text-gray-500">Oct 05, 2023</td>
                            <td class="p-3 text-center">2,890</td>
                            <td class="p-3 text-right font-bold text-green-600">62%</td>
                        </tr>
                        <tr>
                            <td class="p-3 font-bold text-gray-700 dark:text-gray-200">Freshers Hackathon</td>
                            <td class="p-3 text-gray-500">Sep 28, 2023</td>
                            <td class="p-3 text-center">850</td>
                            <td class="p-3 text-right font-bold text-green-600">88%</td>
                        </tr>
                    </tbody>
                </table>
            `;

    } else if (type === 'Problems') {
        title.textContent = 'Problem Bank Export';
        badge.textContent = 'XLSX EXPORT';
        badge.className = 'px-3 py-1 bg-green-100 text-green-600 rounded-full text-[10px] font-bold uppercase';

        container.innerHTML = `
                <select class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2.5 text-xs bg-white dark:bg-gray-800 dark:text-gray-300">
                    <option>All Difficulties</option>
                    <option>Easy</option>
                    <option>Medium</option>
                    <option>Hard</option>
                </select>
                <select class="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2.5 text-xs bg-white dark:bg-gray-800 dark:text-gray-300">
                    <option>All Tags</option>
                    <option>Arrays</option>
                    <option>DP</option>
                    <option>Graphs</option>
                </select>
            `;

        tableContainer.innerHTML = `
                <div class="p-8 text-center text-gray-400 italic">
                    <i class="fas fa-table text-4xl mb-3 opacity-20"></i>
                    <p>Select multiple filters to generate specific problem sets.</p>
                </div>
            `;
    }
}

function handleReportDownload() {
    const type = document.getElementById('reportType').value;

    if (type === 'Contests') {
        const printWindow = window.open('', '', 'height=900,width=1400');

        const reportDate = new Date().toLocaleDateString();
        const stats = {
            totalContests: 12,
            activeStudents: 450,
            avgClassAccuracy: 65,
            topDept: "CSE",
            avgRuntime: "1.2s",
            platformUptime: "99.9%",
            peakUsers: 512
        };

        const htmlContent = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Aggregate Contest Analytics Report</title>
                <script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; margin: 0; padding: 40px; color: #333; -webkit-print-color-adjust: exact; }
                    .container { max-width: 1200px; margin: 0 auto; }
                    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
                    
                    /* Header */
                    .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid #6366f1; padding-bottom: 20px; }
                    .header h1 { margin: 0; color: #1e1b4b; font-size: 2.2rem; text-transform: uppercase; letter-spacing: 1px; }
                    .header p { margin: 5px 0 0; color: #64748b; font-size: 1rem; }

                    /* KPI Cards */
                    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
                    .kpi-card { background: white; padding: 20px; border-radius: 12px; border-left: 5px solid #6366f1; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
                    .kpi-value { font-size: 2rem; font-weight: 800; color: #1e1b4b; display: block; }
                    .kpi-label { font-size: 0.85rem; color: #64748b; font-weight: 600; text-transform: uppercase; }

                    /* Section Titles */
                    .section-header { font-size: 1.3rem; color: #334155; margin: 30px 0 20px 0; font-weight: 700; display: flex; align-items: center; gap: 10px; }
                    .section-header::before { content: ''; display: block; width: 6px; height: 24px; background: #6366f1; border-radius: 3px; }

                    /* Charts */
                    .chart-container { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; page-break-inside: avoid; }
                    .chart-title { font-size: 1rem; color: #475569; margin-bottom: 15px; font-weight: 700; text-align: center; }

                    /* Table Styles */
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
                    th { background: #6366f1; color: white; padding: 12px; text-align: left; font-size: 0.85rem; text-transform: uppercase; }
                    td { padding: 12px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 0.9rem; }
                    tr:last-child td { border-bottom: none; }
                    .status-badge { padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold; }
                    .status-completed { background: #dcfce7; color: #166534; }
                    .rank-gold { color: #d97706; font-weight: bold; }

                    .footer { margin-top: 50px; text-align: center; font-size: 0.8rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Contest Analytics Overview</h1>
                        <p>Aggregated Performance Report • ${reportDate}</p>
                    </div>

                    <!-- Executive Summary -->
                    <div class="kpi-grid">
                        <div class="kpi-card">
                            <span class="kpi-value">${stats.totalContests}</span>
                            <span class="kpi-label">Total Events</span>
                        </div>
                        <div class="kpi-card">
                            <span class="kpi-value">${stats.activeStudents}</span>
                            <span class="kpi-label">Active Users</span>
                        </div>
                        <div class="kpi-card">
                            <span class="kpi-value">${stats.avgClassAccuracy}%</span>
                            <span class="kpi-label">Global Accuracy</span>
                        </div>
                        <div class="kpi-card">
                            <span class="kpi-value">${stats.platformUptime}</span>
                            <span class="kpi-label">Uptime</span>
                        </div>
                    </div>

                    <!-- Top Row: Trends & Leaderboard -->
                    <div class="grid-2">
                        <div>
                            <div class="section-header" style="margin-top:0;">Student Leaderboard</div>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Rank</th>
                                        <th>Student</th>
                                        <th>Points</th>
                                        <th>Victories</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td class="rank-gold">#1</td>
                                        <td>Alice Cooper</td>
                                        <td>2,450</td>
                                        <td>3</td>
                                    </tr>
                                    <tr>
                                        <td>#2</td>
                                        <td>Bob Smith</td>
                                        <td>2,100</td>
                                        <td>1</td>
                                    </tr>
                                    <tr>
                                        <td>#3</td>
                                        <td>Charlie Brown</td>
                                        <td>1,980</td>
                                        <td>0</td>
                                    </tr>
                                    <tr>
                                        <td>#4</td>
                                        <td>Diana Prince</td>
                                        <td>1,850</td>
                                        <td>1</td>
                                    </tr>
                                    <tr>
                                        <td>#5</td>
                                        <td>Evan Wright</td>
                                        <td>1,720</td>
                                        <td>0</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                         
                        <div style="display:flex; flex-direction:column;">
                             <div class="section-header" style="margin-top:0;">Participation Trends</div>
                             <div class="chart-container" style="flex:1;">
                                <canvas id="participationTrendChart"></canvas>
                            </div>
                        </div>
                    </div>

                    <!-- Middle Row: Demographics & Performance -->
                    <div class="grid-3 mt-4">
                        <div class="chart-container">
                            <div class="chart-title">Year-wise Distribution</div>
                            <canvas id="yearPieChart"></canvas>
                        </div>
                        <div class="chart-container">
                             <div class="chart-title">Dept Performance</div>
                             <canvas id="deptPerformanceChart"></canvas>
                        </div>
                         <div class="chart-container">
                             <div class="chart-title">Operational Metrics</div>
                             <div style="text-align:center; padding: 20px 0;">
                                <div style="margin-bottom:20px;">
                                    <div style="font-size: 2.5rem; font-weight:bold; color:#6366f1;">${stats.avgRuntime}</div>
                                    <div style="font-size:0.8rem; text-transform:uppercase; color:#64748b;">Avg Code Runtime</div>
                                </div>
                                <div>
                                    <div style="font-size: 2.5rem; font-weight:bold; color:#10b981;">${stats.peakUsers}</div>
                                    <div style="font-size:0.8rem; text-transform:uppercase; color:#64748b;">Peak Concurrent</div>
                                </div>
                             </div>
                        </div>
                    </div>

                    <!-- Bottom: Recent Contests -->
                    <div class="section-header">Recent Contests Summary</div>
                    <table>
                        <thead>
                            <tr>
                                <th>Contest Name</th>
                                <th>Date</th>
                                <th>Difficulty</th>
                                <th>Participants</th>
                                <th>Avg Score</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Weekly Challenge #42</td>
                                <td>Oct 12, 2023</td>
                                <td>Medium</td>
                                <td>145</td>
                                <td>76%</td>
                                <td><span class="status-badge status-completed">Completed</span></td>
                            </tr>
                            <tr>
                                <td>DSA Grand Contest</td>
                                <td>Oct 05, 2023</td>
                                <td>Hard</td>
                                <td>210</td>
                                <td>62%</td>
                                <td><span class="status-badge status-completed">Completed</span></td>
                            </tr>
                            <tr>
                                <td>Freshers Hackathon</td>
                                <td>Sep 28, 2023</td>
                                <td>Easy</td>
                                <td>350</td>
                                <td>88%</td>
                                <td><span class="status-badge status-completed">Completed</span></td>
                            </tr>
                            <tr>
                                <td>Algorithm Sprint</td>
                                <td>Sep 15, 2023</td>
                                <td>Hard</td>
                                <td>120</td>
                                <td>55%</td>
                                <td><span class="status-badge status-completed">Completed</span></td>
                            </tr>
                             <tr>
                                <td>Debug Quest</td>
                                <td>Sep 10, 2023</td>
                                <td>Medium</td>
                                <td>180</td>
                                <td>70%</td>
                                <td><span class="status-badge status-completed">Completed</span></td>
                            </tr>
                        </tbody>
                    </table>

                    <div class="footer">
                        Generated automatically by CampusCode Reporting Module.
                    </div>
                </div>

                <script>
                    setTimeout(() => {
                        Chart.defaults.font.family = "'Segoe UI', sans-serif";
                        
                        // 1. Participation Trend (Line)
                        new Chart(document.getElementById('participationTrendChart'), {
                            type: 'line',
                            data: {
                                labels: ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
                                datasets: [{
                                    label: 'Active Participants',
                                    data: [120, 150, 180, 300, 350, 450],
                                    borderColor: '#6366f1',
                                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                                    fill: true,
                                    tension: 0.4
                                }]
                            },
                            options: { 
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } }, 
                                scales: { y: { beginAtZero: true, grid: { display: false } }, x: { grid: { display:false } } } 
                            }
                        });

                        // 2. Dept Performance (Bar)
                        new Chart(document.getElementById('deptPerformanceChart'), {
                            type: 'bar',
                            data: {
                                labels: ['CSE', 'IT', 'ECE', 'EEE', 'Mech'],
                                datasets: [{
                                    label: 'Avg Score %',
                                    data: [82, 78, 65, 60, 55],
                                    backgroundColor: ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff'],
                                    borderRadius: 5
                                }]
                            },
                            options: { scales: { y: { max: 100 } }, plugins: { legend: { display: false } } }
                        });

                        // 3. Year Distribution (Pie)
                        new Chart(document.getElementById('yearPieChart'), {
                            type: 'doughnut',
                            data: {
                                labels: ['1st Year', '2nd Year', '3rd Year', '4th Year'],
                                datasets: [{
                                    data: [40, 30, 20, 10],
                                    backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
                                    borderWidth: 0
                                }]
                            },
                            options: { cutout: '60%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } }
                        });

                        setTimeout(() => window.print(), 800);
                    }, 500);
                <\/script>
            </body>
            </html>
        `;

        printWindow.document.write(htmlContent);
        printWindow.document.close();
    } else {
        alert(`Requesting ${type} download... (Feature coming soon)`);
    }
}

// Initialize on load
if (document.getElementById('reportType')) {
    initReportUI();
}

document.addEventListener("DOMContentLoaded", function () {
    const btnSettingsOverlay = document.getElementById('btn-settings-overlay');
    const settingsOverlayMenu = document.getElementById('settingsOverlayMenu');

    if (btnSettingsOverlay && settingsOverlayMenu) {
        // Toggle Menu
        btnSettingsOverlay.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsOverlayMenu.classList.toggle('hidden');
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!settingsOverlayMenu.classList.contains('hidden') &&
                !settingsOverlayMenu.contains(e.target) &&
                !btnSettingsOverlay.contains(e.target)) {
                settingsOverlayMenu.classList.add('hidden');
            }
        });

        // Menu Actions
        const menuItemProfile = document.getElementById('menuItemProfile');
        const menuItemSettings = document.getElementById('menuItemSettings');
        const menuItemSnippets = document.getElementById('menuItemSnippets');
        const menuItemUpdates = document.getElementById('menuItemUpdates');

        if (menuItemProfile) {
            menuItemProfile.addEventListener('click', () => {
                settingsOverlayMenu.classList.add('hidden');
                const profileOverlay = document.getElementById('profileOverlay');
                if (profileOverlay) profileOverlay.classList.remove('hidden');
            });
        }

        if (menuItemSettings) {
            menuItemSettings.addEventListener('click', () => {
                window.location.href = 'settings.html';
            });
        }

        if (menuItemSnippets) {
            menuItemSnippets.addEventListener('click', () => {
                alert('User Snippets feature coming soon!');
                settingsOverlayMenu.classList.add('hidden');
            });
        }

        if (menuItemUpdates) {
            menuItemUpdates.addEventListener('click', () => {
                alert('Checking for updates... Your version is up to date.');
                settingsOverlayMenu.classList.add('hidden');
            });
        }
    }


    // FACULTY HOVER EFFECTS
    const facultyProfileTooltip = document.getElementById('facultyProfileTooltip');
    const subjectListTooltip = document.getElementById('subjectListTooltip');

    if (facultyProfileTooltip) {
        // Faculty Name Hover
        document.addEventListener('mouseover', (e) => {
            const trigger = e.target.closest('.faculty-name-trigger');
            if (trigger) {
                const rect = trigger.getBoundingClientRect();
                const dataset = trigger.dataset;

                // Populate Tooltip
                const toolName = document.getElementById('tooltipName');
                if (toolName) toolName.textContent = dataset.name;

                const toolInitials = document.getElementById('tooltipInitials');
                if (toolInitials && dataset.name) toolInitials.textContent = dataset.name.split(' ').map(n => n[0]).join('').substring(0, 2);

                const toolEmail = document.getElementById('tooltipEmail');
                if (toolEmail) toolEmail.textContent = dataset.email;

                const toolDept = document.getElementById('tooltipDept');
                if (toolDept) toolDept.textContent = dataset.dept;

                const toolDesig = document.getElementById('tooltipDesignation');
                if (toolDesig) toolDesig.textContent = dataset.role;

                const toolJoin = document.getElementById('tooltipJoinDate');
                if (toolJoin) toolJoin.textContent = dataset.joined;

                const toolId = document.getElementById('tooltipId');
                if (toolId) toolId.textContent = dataset.facultyId;

                // Position Tooltip
                facultyProfileTooltip.style.left = `${rect.left + window.scrollX}px`;
                facultyProfileTooltip.style.top = `${rect.bottom + window.scrollY + 10}px`;

                // Show Tooltip
                facultyProfileTooltip.classList.remove('hidden', 'opacity-0', 'scale-95');
                facultyProfileTooltip.classList.add('opacity-100', 'scale-100');
            }
        });

        document.addEventListener('mouseout', (e) => {
            const trigger = e.target.closest('.faculty-name-trigger');
            if (trigger) {
                facultyProfileTooltip.classList.remove('opacity-100', 'scale-100');
                facultyProfileTooltip.classList.add('opacity-0', 'scale-95');
                setTimeout(() => {
                    if (facultyProfileTooltip.classList.contains('opacity-0')) {
                        facultyProfileTooltip.classList.add('hidden');
                    }
                }, 200);
            }
        });
    }

    if (subjectListTooltip) {
        // Subject Count Hover
        document.addEventListener('mouseover', (e) => {
            const trigger = e.target.closest('.subject-count-trigger');
            if (trigger) {
                const rect = trigger.getBoundingClientRect();
                const subjects = JSON.parse(trigger.dataset.subjects || '[]');

                // Populate Tooltip
                const list = document.getElementById('tooltipSubjectList');
                if (list) {
                    list.innerHTML = subjects.map(sub => `
                        <li class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                            <i class="fas fa-check-circle text-green-500 text-[10px]"></i> ${sub}
                        </li>
                    `).join('');
                }

                // Position Tooltip
                subjectListTooltip.style.left = `${rect.left + window.scrollX}px`;
                subjectListTooltip.style.top = `${rect.bottom + window.scrollY + 10}px`;

                // Show Tooltip
                subjectListTooltip.classList.remove('hidden', 'opacity-0', 'scale-95');
                subjectListTooltip.classList.add('opacity-100', 'scale-100');
            }
        });

        document.addEventListener('mouseout', (e) => {
            const trigger = e.target.closest('.subject-count-trigger');
            if (trigger) {
                subjectListTooltip.classList.remove('opacity-100', 'scale-100');
                subjectListTooltip.classList.add('opacity-0', 'scale-95');
                setTimeout(() => {
                    if (subjectListTooltip.classList.contains('opacity-0')) {
                        subjectListTooltip.classList.add('hidden');
                    }
                }, 200);
            }
        });
    }


    // EDIT FACULTY MODAL LOGIC
    const editFacultyModal = document.getElementById('editFacultyModal');
    const closeEditFacultyModal = document.getElementById('closeEditFacultyModal');
    const cancelEditFaculty = document.getElementById('cancelEditFaculty');
    const editFacultyForm = document.getElementById('editFacultyForm');

    if (editFacultyModal) {
        // Open Modal
        document.addEventListener('click', (e) => {
            const editBtn = e.target.closest('button[title="Edit"]');
            if (editBtn) {
                const row = editBtn.closest('tr');
                const trigger = row.querySelector('.faculty-name-trigger');

                if (trigger) {
                    const data = trigger.dataset;

                    // Populate Form
                    document.getElementById('editFacultyId').value = data.facultyId;
                    document.getElementById('editFacultyName').value = data.name;
                    document.getElementById('editFacultyEmail').value = data.email;
                    document.getElementById('editFacultyDept').value = data.dept;
                    document.getElementById('editFacultyRole').value = data.role;

                    // Try to guess status if available, else default to Active
                    // In a real app, this data would also be in a dataset
                    document.getElementById('editFacultyStatus').value = "Active";

                    editFacultyModal.classList.remove('hidden');
                }
            }
        });

        // Close Modal Handlers
        const closeModal = () => {
            editFacultyModal.classList.add('hidden');
        };

        if (closeEditFacultyModal) closeEditFacultyModal.addEventListener('click', closeModal);
        if (cancelEditFaculty) cancelEditFaculty.addEventListener('click', closeModal);

        // Close on click outside
        editFacultyModal.addEventListener('click', (e) => {
            if (e.target === editFacultyModal) closeModal();
        });

        // Save Form
        if (editFacultyForm) {
            editFacultyForm.addEventListener('submit', (e) => {
                e.preventDefault();
                alert('Faculty details updated successfully! (Mock Action)');
                closeModal();
                // Here you would typically send data to backend and update the DOM row
            });
        }
    }

    // FACULTY SUBJECT FILTER LOGIC
    const subjectFilter = document.getElementById('facultySubjectFilter');
    if (subjectFilter) {
        subjectFilter.addEventListener('change', (e) => {
            const selectedSubject = e.target.value;
            const rows = document.querySelectorAll('#section-manage-faculty table tbody tr'); // Targeted selector

            rows.forEach(row => {
                const subjectTrigger = row.querySelector('.subject-count-trigger');
                if (subjectTrigger && subjectTrigger.dataset.subjects) {
                    try {
                        const subjects = JSON.parse(subjectTrigger.dataset.subjects);
                        if (selectedSubject === "All Subjects") {
                            row.style.display = '';
                        } else {
                            if (subjects.includes(selectedSubject)) {
                                row.style.display = '';
                            } else {
                                row.style.display = 'none';
                            }
                        }
                    } catch (err) {
                        console.error("Error parsing subjects JSON", err);
                    }
                }
            });
        });
    }

    // --- GLOBAL LOGOUT LOGIC ---
    const globalLogout = () => { window.location.href = '/auth/logout'; };
    const btnLogoutGlobal = document.getElementById('btnLogout');
    const logoutBtnGlobal = document.getElementById('logoutBtn');

    if (btnLogoutGlobal) btnLogoutGlobal.addEventListener('click', globalLogout);
    if (logoutBtnGlobal) logoutBtnGlobal.addEventListener('click', globalLogout);

    // --- QUICK ACTION URL HANDLER ---
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'create') {
        const btnCreateProblem = document.getElementById('btn-create-problem');
        const btnCreateContest = document.getElementById('btn-create-contest');
        if (btnCreateProblem) setTimeout(() => btnCreateProblem.click(), 100);
        if (btnCreateContest) setTimeout(() => btnCreateContest.click(), 100);
    }

    // --- CONTEST ACTION VIEWS LOGIC ---

    // 1. View Details Modal
    const detailsModal = document.getElementById('detailsModal');
    const contestListUpcomingContainer = document.getElementById('contest-list-upcoming'); // Valid Variable Name

    if (contestListUpcomingContainer) {
        contestListUpcomingContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-view-details');
            if (btn && detailsModal) {
                const data = btn.dataset;

                // Populate Modal
                const title = document.getElementById('detFullTitle');
                if (title) title.textContent = data.title || 'Contest Details';

                const desc = document.getElementById('detDesc');
                if (desc) desc.textContent = data.desc || 'No description available.';

                const eligibility = document.getElementById('detEligibility');
                if (eligibility) eligibility.textContent = data.eligibility || 'Open for all';

                const deadlineFull = document.getElementById('detDeadlineFull');
                const deadlineDate = new Date(data.deadline || Date.now());
                if (deadlineFull) deadlineFull.textContent = deadlineDate.toLocaleString('en-US', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });

                const detDay = document.getElementById('detDay');
                if (detDay) detDay.textContent = deadlineDate.getDate();

                const detMonth = document.getElementById('detMonth');
                if (detMonth) detMonth.textContent = deadlineDate.toLocaleString('default', { month: 'short' });

                // Start Countdown
                startContestTimer(deadlineDate);

                // Show Modal
                detailsModal.classList.remove('hidden');
                setTimeout(() => {
                    const content = document.getElementById('detailsModalContent');
                    if (content) {
                        content.classList.remove('opacity-0', 'scale-95');
                        content.classList.add('opacity-100', 'scale-100');
                    }
                }, 10);
            }
        });
    }

    // Close Details Modal
    const btnModalClose = document.getElementById('btn-modal-close');
    const btnModalEdit = document.getElementById('btn-modal-edit'); // Just closes for now or redirects

    const closeDetailsModal = () => {
        const content = document.getElementById('detailsModalContent');
        if (content) {
            content.classList.remove('opacity-100', 'scale-100');
            content.classList.add('opacity-0', 'scale-95');
        }
        setTimeout(() => {
            if (detailsModal) detailsModal.classList.add('hidden');
        }, 300);
    };

    if (btnModalClose) btnModalClose.addEventListener('click', closeDetailsModal);
    if (btnModalEdit) btnModalEdit.addEventListener('click', () => {
        alert('Edit Contest feature coming soon!');
        closeDetailsModal();
    });

    if (detailsModal) {
        detailsModal.addEventListener('click', (e) => {
            if (e.target === detailsModal) closeDetailsModal();
        });
    }

    // Timer Logic
    let contestTimerInterval;
    function startContestTimer(deadline) {
        if (contestTimerInterval) clearInterval(contestTimerInterval);

        const updateTimer = () => {
            const now = new Date().getTime();
            const distance = deadline.getTime() - now;

            const timerDisplay = document.getElementById('timerDisplay');
            if (!timerDisplay) return;

            if (distance < 0) {
                clearInterval(contestTimerInterval);
                timerDisplay.textContent = "REGISTRATION CLOSED";
                timerDisplay.classList.add('text-red-500');
                return;
            }

            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            timerDisplay.textContent = `${days}d : ${hours}h : ${minutes}m : ${seconds}s`;
            timerDisplay.classList.remove('text-red-500');
        };

        updateTimer();
        contestTimerInterval = setInterval(updateTimer, 1000);
    }


    // 2. Leaderboard Modal
    const leaderboardModal = document.getElementById('leaderboardModal');
    const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');

    // Delegation for upcoming contests list
    if (contestListUpcomingContainer) {
        contestListUpcomingContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-view-leaderboard');
            if (btn && leaderboardModal) {
                leaderboardModal.classList.remove('hidden');
            }
        });
    }

    if (closeLeaderboardBtn) {
        closeLeaderboardBtn.addEventListener('click', () => {
            leaderboardModal.classList.add('hidden');
        });
    }
    if (leaderboardModal) {
        leaderboardModal.addEventListener('click', (e) => {
            if (e.target === leaderboardModal) leaderboardModal.classList.add('hidden');
        });
    }


    // 3. Results Modal
    const resultsModal = document.getElementById('resultsModal');
    const closeResultsBtn = document.getElementById('closeResultsBtn');
    const contestListPastContainer = document.getElementById('contest-list-past');

    if (contestListPastContainer) {
        contestListPastContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-view-results');
            if (btn && resultsModal) {
                resultsModal.classList.remove('hidden');
            }
        });
    }

    if (closeResultsBtn) {
        closeResultsBtn.addEventListener('click', () => {
            resultsModal.classList.add('hidden');
        });
    }
    if (resultsModal) {
        resultsModal.addEventListener('click', (e) => {
            if (e.target === resultsModal) resultsModal.classList.add('hidden');
        });
    }

});
