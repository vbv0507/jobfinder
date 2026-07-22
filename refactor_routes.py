import os, re

base_dir = r'd:\new\NODE\jobfinder'

def update_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'index.js' in filepath:
        content = content.replace('const { clerkMiddleware, requireClerkPageAuth } = require("./middleware/clerkAuth");', 
                                  'const { clerkMiddleware, requireAuth } = require("./middleware/authMiddleware");')
        content = content.replace('requireClerkPageAuth', 'requireAuth')
    else:
        content = re.sub(r'const \{ requireClerkApiAuth \} = require\([\'\"](?:\.\./)?middleware/clerkAuth[\'\"]\);',
                         'const { requireAdmin, requireViewer } = require("../middleware/authMiddleware");',
                         content)
        content = content.replace('requireClerkApiAuth', 'requireAdmin')
        
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

for root, dirs, files in os.walk(base_dir):
    if 'node_modules' in root or '.git' in root: continue
    for file in files:
        if file.endswith('.js'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            if 'clerkAuth' in content or 'requireClerk' in content:
                print('Updating', filepath)
                update_file(filepath)

print('Done')
