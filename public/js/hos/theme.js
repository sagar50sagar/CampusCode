/**
 * HOS Module – Shared Theme Manager
 * Applies dark/light/system mode on every page load.
 * Must be loaded in <head> as a BLOCKING script so it runs before painting.
 */
(function () {
    'use strict';

    /**
     * Determine the effective theme (dark | light) from localStorage or system preference.
     */
    function getEffectiveTheme() {
        var saved = localStorage.getItem('theme');
        if (saved === 'dark') return 'dark';
        if (saved === 'light') return 'light';
        // 'system' or none → follow OS
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    /**
     * Full theme application: toggles the <html> .dark class and updates the
     * header toggle icon.  Safe to call before or after DOMContentLoaded.
     * @param {'dark'|'light'|'system'} themeName
     */
    function applyTheme(themeName) {
        var html = document.documentElement;
        var isDark;

        if (themeName === 'dark') {
            html.classList.add('dark');
            localStorage.setItem('theme', 'dark');
            isDark = true;
        } else if (themeName === 'light') {
            html.classList.remove('dark');
            localStorage.setItem('theme', 'light');
            isDark = false;
        } else {
            // system
            localStorage.removeItem('theme');
            isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (isDark) html.classList.add('dark');
            else html.classList.remove('dark');
        }

        // Update the header toggle button icon (may not exist yet — that's OK)
        updateToggleIcon(isDark);

        // Highlight active check-icon in settings menu
        updateCheckIcons(themeName === 'system' ? 'system' : (isDark ? 'dark' : 'light'));
    }

    /** Update the sun/moon icon of #themeToggleBtn */
    function updateToggleIcon(isDark) {
        var btn = document.getElementById('themeToggleBtn');
        if (!btn) return;
        var icon = btn.querySelector('i');
        if (!icon) return;
        if (isDark) {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        } else {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
    }

    /** Update the check-icons inside the settings theme picker */
    function updateCheckIcons(activeValue) {
        var options = document.querySelectorAll('.theme-option');
        options.forEach(function (btn) {
            var checkIcon = btn.querySelector('.check-icon');
            if (!checkIcon) return;
            if (btn.getAttribute('data-value') === activeValue) {
                btn.classList.add('bg-primary-50', 'text-primary-600');
                btn.classList.remove('bg-transparent');
                checkIcon.classList.remove('opacity-0');
            } else {
                btn.classList.remove('bg-primary-50', 'text-primary-600');
                checkIcon.classList.add('opacity-0');
            }
        });
    }

    // ─── Apply immediately (before DOM paint) ────────────────────────────────
    var effective = getEffectiveTheme();
    if (effective === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }

    // ─── Wire up interactive controls after DOM is ready ─────────────────────
    function initThemeControls() {
        var savedTheme = localStorage.getItem('theme') || 'system';

        // Sync the icon now that DOM is available
        updateToggleIcon(document.documentElement.classList.contains('dark'));
        updateCheckIcons(savedTheme);

        // Header toggle button (sun/moon)
        var themeBtn = document.getElementById('themeToggleBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', function () {
                applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
            });
        }

        // Settings menu theme options
        var themeOptions = document.querySelectorAll('.theme-option');
        themeOptions.forEach(function (opt) {
            opt.addEventListener('click', function (e) {
                e.stopPropagation();
                applyTheme(opt.getAttribute('data-value'));
            });
        });

        // Settings theme accordion
        var accordionBtn = document.getElementById('themeAccordionBtn');
        var optionsContainer = document.getElementById('themeOptionsContainer');
        var chevron = document.getElementById('themeChevron');
        if (accordionBtn && optionsContainer) {
            accordionBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var isHidden = optionsContainer.classList.toggle('hidden');
                if (chevron) chevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(90deg)';
            });
        }

        // Settings trigger popup
        var settingsTrigger = document.getElementById('settingsTrigger');
        var settingsMenu = document.getElementById('settingsMenu');
        var sidebar = document.getElementById('mainSidebar');
        if (settingsTrigger && settingsMenu) {
            settingsTrigger.addEventListener('click', function (e) {
                e.stopPropagation();
                settingsMenu.classList.toggle('hidden');
                if (sidebar && sidebar.classList.contains('collapsed')) {
                    settingsMenu.style.left = '80px';
                } else {
                    settingsMenu.style.left = '16px';
                }
            });
            document.addEventListener('click', function (e) {
                if (!settingsMenu.contains(e.target) && !settingsTrigger.contains(e.target)) {
                    settingsMenu.classList.add('hidden');
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initThemeControls);
    } else {
        initThemeControls();
    }

    // Expose globally so settings.ejs inline onclick="applyTheme(...)" still works
    window.applyTheme = applyTheme;
})();
