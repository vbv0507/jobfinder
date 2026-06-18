// profile.js - Profile page logic
// Matches backend CandidateProfile model:
// { name, graduationYear, skills[], preferredRoles[], preferredLocations[], projects[], careerPreferences[] }

let isEditing = true;

// Convert a comma-separated string into a clean array of trimmed values.
function toArray(value) {
    if (!value) return [];
    return value
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);
}

// Convert an array (or value) into a comma-separated string for display/inputs.
function toCommaString(value) {
    if (Array.isArray(value)) return value.join(', ');
    return value || '';
}

async function loadProfile() {
    try {
        const response = await apiCall('/profile');
        // Backend returns { success, profile }
        const profile = response.profile;

        if (!profile) {
            // No profile yet, show form
            isEditing = true;
            document.getElementById('profile-form').style.display = 'block';
            document.getElementById('profile-display').style.display = 'none';
            return;
        }

        // Load profile data into form
        document.getElementById('name').value = profile.name || '';
        document.getElementById('graduation-year').value = profile.graduationYear || '';
        document.getElementById('skills').value = toCommaString(profile.skills);
        document.getElementById('preferred-roles').value = toCommaString(profile.preferredRoles);
        document.getElementById('preferred-locations').value = toCommaString(profile.preferredLocations);
        document.getElementById('projects').value = toCommaString(profile.projects);
        document.getElementById('career-preferences').value = toCommaString(profile.careerPreferences);

        // Show profile display
        isEditing = false;
        displayProfile(profile);
    } catch (error) {
        console.log('No profile found, showing form');
    }
}

function renderList(values) {
    const arr = Array.isArray(values) ? values : toArray(values);
    if (arr.length === 0) return 'Not set';
    return arr.join(', ');
}

function displayProfile(profile) {
    const profileInfo = document.getElementById('profile-info');
    profileInfo.innerHTML = `
        <div class="profile-info">
            <p><strong>Name:</strong> ${profile.name || 'Not set'}</p>
            <p><strong>Graduation Year:</strong> ${profile.graduationYear || 'Not set'}</p>
            <p><strong>Skills:</strong> ${renderList(profile.skills)}</p>
            <p><strong>Preferred Roles:</strong> ${renderList(profile.preferredRoles)}</p>
            <p><strong>Preferred Locations:</strong> ${renderList(profile.preferredLocations)}</p>
            <p><strong>Projects:</strong> ${renderList(profile.projects)}</p>
            <p><strong>Career Preferences:</strong> ${renderList(profile.careerPreferences)}</p>
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
                name: document.getElementById('name').value,
                graduationYear: parseInt(document.getElementById('graduation-year').value) || undefined,
                skills: toArray(document.getElementById('skills').value),
                preferredRoles: toArray(document.getElementById('preferred-roles').value),
                preferredLocations: toArray(document.getElementById('preferred-locations').value),
                projects: toArray(document.getElementById('projects').value),
                careerPreferences: toArray(document.getElementById('career-preferences').value)
            };

            try {
                await apiCall('/profile', 'POST', profileData);
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
