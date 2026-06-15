// profile.js - Profile page logic

let isEditing = true;

async function loadProfile() {
    try {
        const response = await apiCall('/profile');
        const profile = response.data || {};
        
        if (Object.keys(profile).length === 0) {
            // No profile yet, show form
            isEditing = true;
            document.getElementById('profile-form').style.display = 'block';
            document.getElementById('profile-display').style.display = 'none';
            return;
        }
        
        // Load profile data into form
        document.getElementById('full-name').value = profile.fullName || '';
        document.getElementById('email').value = profile.email || '';
        document.getElementById('skills').value = profile.skills || '';
        document.getElementById('experience').value = profile.experience || '';
        document.getElementById('job-title').value = profile.jobTitle || '';
        document.getElementById('location').value = profile.location || '';
        document.getElementById('bio').value = profile.bio || '';
        
        // Show profile display
        isEditing = false;
        displayProfile(profile);
    } catch (error) {
        console.log('No profile found, showing form');
    }
}

function displayProfile(profile) {
    const profileInfo = document.getElementById('profile-info');
    profileInfo.innerHTML = `
        <div class="profile-info">
            <p><strong>Name:</strong> ${profile.fullName || 'Not set'}</p>
            <p><strong>Email:</strong> ${profile.email || 'Not set'}</p>
            <p><strong>Skills:</strong> ${profile.skills || 'Not set'}</p>
            <p><strong>Experience:</strong> ${profile.experience ? profile.experience + ' years' : 'Not set'}</p>
            <p><strong>Job Title:</strong> ${profile.jobTitle || 'Not set'}</p>
            <p><strong>Location:</strong> ${profile.location || 'Not set'}</p>
            <p><strong>Bio:</strong> ${profile.bio || 'Not set'}</p>
        </div>
    `;
    
    document.getElementById('profile-display').style.display = 'block';
    document.getElementById('profile-form').style.display = 'none';
}

function editProfile() {
    document.getElementById('profile-form').style.display = 'block';
    document.getElementById('profile-display').style.display = 'none';
}

// Handle profile form submission
document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
    
    const form = document.getElementById('profile-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const profileData = {
                fullName: document.getElementById('full-name').value,
                email: document.getElementById('email').value,
                skills: document.getElementById('skills').value,
                experience: parseInt(document.getElementById('experience').value) || 0,
                jobTitle: document.getElementById('job-title').value,
                location: document.getElementById('location').value,
                bio: document.getElementById('bio').value
            };
            
            try {
                const response = await apiCall('/profile', 'POST', profileData);
                showAlert('Profile saved successfully!', 'success');
                
                // Reload profile
                setTimeout(() => {
                    loadProfile();
                }, 500);
            } catch (error) {
                showAlert('Failed to save profile', 'error');
            }
        });
    }
});
