const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        const dirPath = path.join(dir, f);
        if (f === 'node_modules' || f === '.git' || f === '.gemini' || f === 'public') return;
        const isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
    });
}

const errors = [];
walkDir(__dirname, (filePath) => {
    if (filePath.endsWith('.js')) {
        try {
            execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
        } catch (error) {
            errors.push(`File: ${filePath}\n${error.stderr.toString()}`);
        }
    }
});

if (errors.length > 0) {
    console.log("SYNTAX ERRORS FOUND:");
    console.log(errors.join("\n\n"));
} else {
    console.log("NO SYNTAX ERRORS FOUND.");
}
