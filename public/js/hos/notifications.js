/**
 * Custom Notification System
 * 
 * Provides beautiful toast notifications and confirmation dialogs
 * to replace browser alert() and confirm() functions.
 * 
 * Usage:
 * - showToast(message, type, title) - Display auto-dismissing toast notifications
 * - showConfirm(message, title, type) - Display confirmation dialog (returns Promise)
 * 
 * Toast Types: 'success', 'error', 'warning', 'info'
 * Confirm Types: 'warning', 'danger', 'info', 'success'
 */

/* Custom Notification System - Toast and Confirmation Dialogs */

// ============================================
// TOAST NOTIFICATIONS (Auto-dismiss messages)
// ============================================

let toastTimeout;

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - Type of toast: 'success', 'error', 'warning', or 'info'
 * @param {string} title - Optional custom title (defaults based on type)
 */

function showToast(message, type = 'success', title = '') {
    const toast = document.getElementById('toastNotification');
    const toastIcon = document.getElementById('toastIcon');
    const toastTitle = document.getElementById('toastTitle');
    const toastMessage = document.getElementById('toastMessage');

    // Clear existing timeout
    if (toastTimeout) clearTimeout(toastTimeout);

    // Configure based on type
    const configs = {
        success: {
            icon: 'fa-check-circle',
            iconBg: 'bg-green-500/10 dark:bg-green-900/30',
            iconColor: 'text-green-500',
            title: title || 'Success',
            iconHtml: '<i class="fas fa-check-circle text-green-500 text-xl"></i>'
        },
        error: {
            icon: 'fa-times-circle',
            iconBg: 'bg-red-500/10 dark:bg-red-900/30',
            iconColor: 'text-red-500',
            title: title || 'Error',
            iconHtml: '<i class="fas fa-times-circle text-red-500 text-xl"></i>'
        },
        warning: {
            icon: 'fa-exclamation-triangle',
            iconBg: 'bg-orange-500/10 dark:bg-orange-900/30',
            iconColor: 'text-orange-500',
            title: title || 'Warning',
            iconHtml: '<i class="fas fa-exclamation-triangle text-orange-500 text-xl"></i>'
        },
        info: {
            icon: 'fa-info-circle',
            iconBg: 'bg-blue-500/10 dark:bg-blue-900/30',
            iconColor: 'text-blue-500',
            title: title || 'Information',
            iconHtml: '<i class="fas fa-info-circle text-blue-500 text-xl"></i>'
        }
    };

    const config = configs[type] || configs.info;

    // Set content
    toastIcon.className = `flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${config.iconBg}`;
    toastIcon.innerHTML = config.iconHtml;
    toastTitle.textContent = config.title;
    toastMessage.textContent = message;

    // Show toast
    toast.classList.remove('hidden');

    // Auto hide after 4 seconds
    toastTimeout = setTimeout(() => {
        hideToast();
    }, 4000);
}

/**
 * Hide the currently displayed toast
 */
function hideToast() {
    const toast = document.getElementById('toastNotification');
    toast.classList.add('hidden');
    if (toastTimeout) clearTimeout(toastTimeout);
}

// ============================================
// CONFIRMATION DIALOGS (Promise-based)
// ============================================
let confirmResolve; // Stores the Promise resolve function

/**
 * Show a confirmation dialog
 * @param {string} message - The confirmation message
 * @param {string} title - Dialog title (default: 'Confirm Action')
 * @param {string} type - Dialog type: 'warning', 'danger', 'info', or 'success'
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false if canceled
 */

function showConfirm(message, title = 'Confirm Action', type = 'warning') {
    return new Promise((resolve) => {
        confirmResolve = resolve;

        const dialog = document.getElementById('confirmDialog');
        const confirmIcon = document.getElementById('confirmIcon');
        const confirmTitle = document.getElementById('confirmTitle');
        const confirmMessage = document.getElementById('confirmMessage');
        const confirmOkBtn = document.getElementById('confirmOkBtn');

        // Configure based on type
        const configs = {
            warning: {
                iconBg: 'bg-orange-500/10 dark:bg-orange-900/30',
                iconHtml: '<i class="fas fa-exclamation-triangle text-orange-500 text-2xl"></i>',
                btnClass: 'bg-orange-500 hover:bg-orange-600'
            },
            danger: {
                iconBg: 'bg-red-500/10 dark:bg-red-900/30',
                iconHtml: '<i class="fas fa-exclamation-circle text-red-500 text-2xl"></i>',
                btnClass: 'bg-red-500 hover:bg-red-600'
            },
            info: {
                iconBg: 'bg-blue-500/10 dark:bg-blue-900/30',
                iconHtml: '<i class="fas fa-info-circle text-blue-500 text-2xl"></i>',
                btnClass: 'bg-primary-500 hover:bg-primary-600'
            },
            success: {
                iconBg: 'bg-green-500/10 dark:bg-green-900/30',
                iconHtml: '<i class="fas fa-check-circle text-green-500 text-2xl"></i>',
                btnClass: 'bg-green-500 hover:bg-green-600'
            }
        };

        const config = configs[type] || configs.warning;

        // Set content
        confirmIcon.className = `flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${config.iconBg}`;
        confirmIcon.innerHTML = config.iconHtml;
        confirmTitle.textContent = title;
        confirmMessage.textContent = message;

        // Update button style
        confirmOkBtn.className = `px-4 py-2 ${config.btnClass} text-white rounded-lg text-sm font-medium transition-colors`;

        // Show dialog
        dialog.classList.remove('hidden');
    });
}

/**
 * Hide the confirmation dialog and resolve the Promise
 * @param {boolean} result - true if confirmed, false if canceled
 */
function hideConfirm(result) {
    const dialog = document.getElementById('confirmDialog');
    dialog.classList.add('hidden');
    if (confirmResolve) {
        confirmResolve(result);
        confirmResolve = null;
    }
}

// ============================================
// EVENT LISTENERS SETUP
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const confirmCancelBtn = document.getElementById('confirmCancelBtn');
    const confirmOkBtn = document.getElementById('confirmOkBtn');
    const confirmDialog = document.getElementById('confirmDialog');

    if (confirmCancelBtn) {
        confirmCancelBtn.addEventListener('click', () => hideConfirm(false));
    }

    if (confirmOkBtn) {
        confirmOkBtn.addEventListener('click', () => hideConfirm(true));
    }

    if (confirmDialog) {
        confirmDialog.addEventListener('click', (e) => {
            if (e.target === confirmDialog) {
                hideConfirm(false);
            }
        });
    }
});
