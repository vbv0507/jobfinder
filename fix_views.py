import os, re

files_to_update = [
    'views/telegram-monitoring.ejs',
    'views/telegram-channels.ejs',
    'views/profile.ejs',
    'views/jobs.ejs',
    'views/job-details.ejs',
    'views/index.ejs',
    'views/companies.ejs',
    'views/analytics.ejs',
    'views/admin/timeline.ejs',
    'views/admin/config.ejs',
    'views/admin/ai.ejs'
]

base_dir = r'd:\new\NODE\jobfinder'

for file_path in files_to_update:
    full_path = os.path.join(base_dir, file_path)
    if not os.path.exists(full_path):
        continue
        
    with open(full_path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    content = re.sub(r'fetch\(([\'\"`])/api/', r'apiCall(\g<1>/api/', content)
    
    if 'partials/header' not in content and '/js/main.js' not in content:
        if '</head>' in content:
            content = content.replace('</head>', '    <script src="/js/main.js"></script>\n</head>')
        else:
            content = content.replace('</body>', '    <script src="/js/main.js"></script>\n</body>')
            
    with open(full_path, 'w', encoding='utf-8') as f:
        f.write(content)

print('Updated files.')
