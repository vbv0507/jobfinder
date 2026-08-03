// core.js
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initMobileSidebar();
});

function initNavigation() {
    const path = window.location.pathname;
    const links = document.querySelectorAll('.nav-link');
    
    links.forEach(link => {
        if (link.getAttribute('href') === path || (path !== '/' && link.getAttribute('href') !== '/' && path.startsWith(link.getAttribute('href')))) {
            link.classList.add('bg-surface', 'text-textMain', 'shadow-sm');
            link.classList.remove('text-textMuted');
            const icon = link.querySelector('i');
            if (icon) {
                icon.classList.add('text-primary');
            }
        }
    });
}

function initMobileSidebar() {
    const btn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    
    if (!btn || !sidebar) return;

    // Load state from localStorage for tablet/desktop
    const isDesktopOrTablet = window.innerWidth >= 768;
    const storedState = localStorage.getItem('sidebar_state');
    
    if (isDesktopOrTablet && storedState === 'closed') {
        sidebar.classList.remove('lg:translate-x-0', 'lg:static');
        sidebar.classList.add('-translate-x-full');
    }

    function toggle() {
        const isOpen = sidebar.classList.contains('translate-x-0') || 
                       (window.innerWidth >= 1024 && !sidebar.classList.contains('-translate-x-full'));
                       
        if (isOpen) {
            sidebar.classList.remove('translate-x-0', 'lg:translate-x-0', 'lg:static');
            sidebar.classList.add('-translate-x-full');
            if (backdrop) {
                backdrop.classList.add('opacity-0');
                setTimeout(() => backdrop.classList.add('hidden'), 300);
            }
            localStorage.setItem('sidebar_state', 'closed');
        } else {
            sidebar.classList.remove('-translate-x-full');
            sidebar.classList.add('translate-x-0', 'lg:translate-x-0', 'lg:static');
            if (backdrop) {
                backdrop.classList.remove('hidden');
                setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
            }
            localStorage.setItem('sidebar_state', 'open');
        }
    }

    if (btn) btn.addEventListener('click', toggle);
    if (backdrop) backdrop.addEventListener('click', toggle);

    // Auto close on mobile navigation (since EJS reloads the page, this happens automatically,
    // but if any client-side routing is added later, this is good practice)
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth < 1024) {
                sidebar.classList.remove('translate-x-0');
                sidebar.classList.add('-translate-x-full');
                if (backdrop) {
                    backdrop.classList.add('opacity-0');
                    setTimeout(() => backdrop.classList.add('hidden'), 300);
                }
            }
        });
    });
}
