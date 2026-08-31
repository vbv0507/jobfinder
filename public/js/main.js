// RoleNova Core Frontend Utilities

const API_BASE = '';

function showAlert(message, type = 'success') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;
    
    const container = document.querySelector('.container') || document.querySelector('main') || document.body;
    if (container) {
        container.insertBefore(alertDiv, container.firstChild);
        setTimeout(() => alertDiv.remove(), 5000);
    }
}

async function apiCall(endpoint, method = 'GET', data = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        if (window.Clerk) {
            if (typeof window.Clerk.load === 'function' && !window.clerkReady) {
                await window.Clerk.load().catch(() => {});
                window.clerkReady = true;
            }
            if (window.Clerk.session) {
                const token = await window.Clerk.session.getToken();
                options.headers['Authorization'] = `Bearer ${token}`;
            }
        }
        
        if (data) {
            options.body = JSON.stringify(data);
        }
        
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        const responseData = await response.json().catch(() => null);
        
        if (!response.ok) {
            const apiMessage = responseData && (responseData.message || responseData.error);
            throw new Error(apiMessage || `API Error: ${response.statusText}`);
        }
        
        return responseData;
    } catch (error) {
        console.error('API Error:', error);
        showAlert(error.message, 'error');
        throw error;
    }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDescription(text, maxLength = 150) {
    if (!text) return 'No description';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

window.apiCall = apiCall;
window.showAlert = showAlert;
window.formatDate = formatDate;
window.formatDescription = formatDescription;

window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) {
        sidebar.classList.toggle('-translate-x-full');
    }
    if (backdrop) {
        backdrop.classList.toggle('hidden');
        setTimeout(() => {
            backdrop.classList.toggle('opacity-0');
            backdrop.classList.toggle('opacity-100');
        }, 10);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) {
        backdrop.addEventListener('click', () => {
            if (typeof toggleSidebar === 'function') toggleSidebar();
        });
    }
});
