import * as fs from 'fs';
import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main(): Promise<void> {
    try {
        let vscodeExecutablePath = await downloadAndUnzipVSCode('stable');

        // Workaround for macOS downloaded test builds: the test runner sometimes
        // resolves to a raw Electron helper that does not accept VS Code CLI flags.
        // If the newer "Code" launcher exists next to it, prefer that.
        if (process.platform === 'darwin' && vscodeExecutablePath.endsWith('/Electron')) {
            const codePath = path.join(vscodeExecutablePath, '..', 'Code');
            if (fs.existsSync(codePath)) {
                vscodeExecutablePath = codePath;
            }
        }

        const extensionDevelopmentPath = path.resolve(__dirname, '../..');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath
        });
    } catch (err) {
        console.error('Failed to run tests:', err);
        process.exit(1);
    }
}

void main();
