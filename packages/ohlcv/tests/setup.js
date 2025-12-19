import * as fs from 'fs';
import * as path from 'path';
// Store which dist directories existed
const distPaths = [];
// Run immediately when this file is loaded (before any imports)
// Delete dist directories to force source resolution
const packages = ['simulation', 'storage', 'utils', 'core', 'api-clients'];
const projectRoot = path.resolve(__dirname, '../..');
for (const pkg of packages) {
    const distPath = path.join(projectRoot, pkg, 'dist');
    if (fs.existsSync(distPath)) {
        try {
            // Delete the dist directory recursively
            fs.rmSync(distPath, { recursive: true, force: true });
            distPaths.push(distPath);
        }
        catch (error) {
            // Ignore errors
        }
    }
}
// Note: We don't restore dist directories after tests
// They will be rebuilt on the next build command
//# sourceMappingURL=setup.js.map