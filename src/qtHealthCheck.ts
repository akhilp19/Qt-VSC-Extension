import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { QtConfigManager } from './qtConfigManager';

interface HealthCheckResult {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
}

export class QtHealthCheck {
    private qtConfigManager: QtConfigManager;
    private outputChannel: vscode.OutputChannel;

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
    }

    dispose(): void {
        // No resources to clean up
    }

    async run(): Promise<void> {
        const results: HealthCheckResult[] = [];

        // 1. Qt installation
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (qtInstallation) {
            try {
                execSync(`"${qtInstallation.qmakePath}" -query QT_VERSION`, { encoding: 'utf-8', stdio: 'pipe' });
                results.push({ name: 'Qt Installation', status: 'pass', message: `${qtInstallation.version} at ${qtInstallation.path}` });
            } catch {
                results.push({ name: 'Qt Installation', status: 'fail', message: 'qmake found but not executable' });
            }
        } else {
            results.push({ name: 'Qt Installation', status: 'fail', message: 'No Qt installation detected' });
        }

        // 2. Compiler
        const makeCmd = this.qtConfigManager.getMakeCommand(qtInstallation || undefined);
        try {
            const compiler = process.platform === 'win32' ? 'cl' : 'g++';
            execSync(`${compiler} --version`, { encoding: 'utf-8', stdio: 'pipe' });
            results.push({ name: 'Compiler', status: 'pass', message: `${compiler} available` });
        } catch {
            results.push({ name: 'Compiler', status: 'warn', message: 'Could not verify compiler in PATH' });
        }

        // 3. Debugger
        const debuggers = process.platform === 'win32' ? ['cppvsdbg'] : process.platform === 'darwin' ? ['lldb'] : ['gdb'];
        const dbgFound = debuggers.some(d => {
            try { execSync(`which ${d}`, { encoding: 'utf-8', stdio: 'pipe' }); return true; } catch { return false; }
        });
        results.push({ name: 'Debugger', status: dbgFound ? 'pass' : 'warn', message: dbgFound ? `${debuggers[0]} available` : 'Debugger not found in PATH' });

        // 4. Build kits
        const config = vscode.workspace.getConfiguration('qt');
        const kits = config.get<{ name: string }[]>('buildKits') || [];
        results.push({ name: 'Build Kits', status: kits.length > 0 ? 'pass' : 'warn', message: `${kits.length} kit(s) configured` });

        // 5. Android SDK/NDK
        const androidSdk = config.get<string>('androidSdkPath');
        if (androidSdk) {
            const sdkValid = fs.existsSync(androidSdk);
            const ndkPath = config.get<string>('androidNdkPath');
            const ndkValid = ndkPath ? fs.existsSync(ndkPath) : false;
            results.push({ name: 'Android SDK', status: sdkValid ? 'pass' : 'fail', message: sdkValid ? `SDK at ${androidSdk}` : 'SDK path invalid' });
            if (ndkPath) {
                results.push({ name: 'Android NDK', status: ndkValid ? 'pass' : 'warn', message: ndkValid ? `NDK at ${ndkPath}` : 'NDK path invalid' });
            }
        }

        // 6. Emscripten
        const emscriptenPath = config.get<string>('emscriptenPath');
        if (emscriptenPath) {
            const emcc = path.join(emscriptenPath, 'upstream', 'emscripten', 'emcc');
            const emccExe = emcc + (process.platform === 'win32' ? '.bat' : '');
            const valid = fs.existsSync(emcc) || fs.existsSync(emccExe);
            results.push({ name: 'Emscripten SDK', status: valid ? 'pass' : 'fail', message: valid ? `SDK at ${emscriptenPath}` : 'emcc not found' });
        }

        // 7. iOS tools (macOS only)
        if (process.platform === 'darwin') {
            try {
                execSync('which xcodebuild', { encoding: 'utf-8', stdio: 'pipe' });
                results.push({ name: 'iOS Tools', status: 'pass', message: 'xcodebuild available' });
            } catch {
                results.push({ name: 'iOS Tools', status: 'warn', message: 'xcodebuild not found' });
            }
        }

        // 8. IntelliSense config
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const cppProps = path.join(workspaceFolder.uri.fsPath, '.vscode', 'c_cpp_properties.json');
            if (fs.existsSync(cppProps)) {
                results.push({ name: 'IntelliSense Config', status: 'pass', message: 'c_cpp_properties.json exists' });
            } else {
                results.push({ name: 'IntelliSense Config', status: 'warn', message: 'c_cpp_properties.json not found' });
            }
        }

        // 9. Project files
        if (workspaceFolder) {
            const hasPro = fs.existsSync(path.join(workspaceFolder.uri.fsPath, 'CMakeLists.txt')) ||
                fs.readdirSync(workspaceFolder.uri.fsPath).some(f => f.endsWith('.pro'));
            results.push({ name: 'Project File', status: hasPro ? 'pass' : 'warn', message: hasPro ? 'CMakeLists.txt or .pro found' : 'No Qt project file detected' });
        }

        // Show report
        const panel = vscode.window.createWebviewPanel('qtHealthCheck', 'Qt Health Check', vscode.ViewColumn.One, {});
        panel.webview.html = this.generateReportHtml(results);
        this.outputChannel.appendLine('[Health Check] Report generated');
    }

    private generateReportHtml(results: HealthCheckResult[]): string {
        const passCount = results.filter(r => r.status === 'pass').length;
        const warnCount = results.filter(r => r.status === 'warn').length;
        const failCount = results.filter(r => r.status === 'fail').length;

        const rows = results.map(r => {
            const icon = r.status === 'pass' ? '🟢' : r.status === 'warn' ? '🟡' : '🔴';
            return `<tr><td>${icon} ${r.name}</td><td>${r.message}</td></tr>`;
        }).join('');

        return `<!DOCTYPE html>
<html>
<head><style>
body { font-family: sans-serif; padding: 20px; }
h2 { margin-top: 0; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
.summary { margin-bottom: 20px; font-size: 1.1em; }
</style></head>
<body>
<h2>Qt C++ Tools — Health Check</h2>
<div class="summary">
<strong>${passCount}</strong> passing, <strong>${warnCount}</strong> warnings, <strong>${failCount}</strong> failures
</div>
<table>
<tr><th>Check</th><th>Result</th></tr>
${rows}
</table>
</body>
</html>`;
    }
}
