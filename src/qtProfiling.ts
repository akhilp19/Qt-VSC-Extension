import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, execSync } from 'child_process';
import { QtConfigManager, QtInstallation } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';
import { isWindows, isMacOS, isLinux, exe, pathExeLookupCmd } from './platformUtils';

interface ProfilerInfo {
    name: string;
    command: string;
    description: string;
    installHint: string;
}

interface SlowTarget {
    file: string;
    lines: number;
    includes: number;
    templates: number;
    score: number;
}

export class QtProfiling {
    private outputChannel: vscode.OutputChannel;
    private qtConfigManager: QtConfigManager;
    private qtProjectDetector: QtProjectDetector;

    constructor(
        qtConfigManager: QtConfigManager,
        qtProjectDetector: QtProjectDetector,
        outputChannel: vscode.OutputChannel
    ) {
        this.qtConfigManager = qtConfigManager;
        this.qtProjectDetector = qtProjectDetector;
        this.outputChannel = outputChannel;
    }

    // ─────────────────────────────────────────────────────────────
    // QML Profiler
    // ─────────────────────────────────────────────────────────────

    async launchQmlProfiler(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (!qtInstallation) {
            void vscode.window.showErrorMessage('No Qt installation found. Configure Qt path first.');
            return;
        }

        // Find built executable
        const executable = await this.findBuiltExecutable(workspaceFolder.uri.fsPath);
        if (!executable) {
            void vscode.window.showErrorMessage('No built executable found. Build the project first.');
            return;
        }

        const qmlDebugPort = vscode.workspace.getConfiguration('qt').get<number>('qmlDebugPort') || 3768;

        // Launch app with QML debugging enabled
        const args = `-qmljsdebugger=port:${qmlDebugPort},block`;
        const terminal = vscode.window.createTerminal({
            name: 'Qt QML Profiler',
            cwd: path.dirname(executable)
        });

        terminal.sendText(`${exe(executable)} ${args}`);
        terminal.show();

        this.outputChannel.appendLine(`Launched QML profiler target: ${executable} ${args}`);

        const choice = await vscode.window.showInformationMessage(
            `QML debugging enabled on port ${qmlDebugPort}. ` +
            'In Qt Creator, go to Analyze → QML Profiler and connect to this port.',
            'Open Qt Creator',
            'Dismiss'
        );

        if (choice === 'Open Qt Creator') {
            const qtcreatorPath = this.findQtCreator(qtInstallation);
            if (qtcreatorPath) {
                spawn(exe(qtcreatorPath), [], { detached: true });
            } else {
                void vscode.window.showWarningMessage(
                    'Qt Creator not found. Please open it manually and connect to the QML Profiler.'
                );
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // CPU Profiler
    // ─────────────────────────────────────────────────────────────

    async launchCpuProfiler(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const executable = await this.findBuiltExecutable(workspaceFolder.uri.fsPath);
        if (!executable) {
            void vscode.window.showErrorMessage('No built executable found. Build the project first.');
            return;
        }

        const profilers = this.detectCpuProfilers();
        if (profilers.length === 0) {
            const platform = process.platform;
            let hint = '';
            if (isLinux()) {
                hint = 'Install perf: sudo apt install linux-tools-generic (Debian/Ubuntu) or sudo pacman -S perf (Arch)';
            } else if (isMacOS()) {
                hint = 'Instruments is included with Xcode. Install Xcode from the App Store.';
            } else if (isWindows()) {
                hint = 'Install Intel VTune or Windows Performance Toolkit.';
            }
            void vscode.window.showErrorMessage('No CPU profiler detected.', hint);
            return;
        }

        const selected = await vscode.window.showQuickPick(
            profilers.map(p => ({
                label: p.name,
                description: p.description,
                detail: p.command,
                profiler: p
            })),
            { placeHolder: 'Select CPU profiler to launch' }
        );

        if (!selected) { return; }

        const profiler = selected.profiler;
        const terminal = vscode.window.createTerminal({
            name: `Qt CPU Profiler (${profiler.name})`,
            cwd: workspaceFolder.uri.fsPath
        });

        let command: string;
        const exePath = quotePath(executable);

        switch (profiler.name) {
            case 'perf':
                command = `perf record -g -- ${exePath}`;
                break;
            case 'Instruments':
                command = `instruments -t "Time Profiler" ${exePath}`;
                break;
            case 'sample':
                command = `sample ${exePath} -file ${path.join(workspaceFolder.uri.fsPath, 'sample_output.txt')}`;
                break;
            case 'VTune':
                command = `vtune -collect hotspots -- ${exePath}`;
                break;
            default:
                command = `${profiler.command} ${exePath}`;
        }

        terminal.sendText(command);
        terminal.show();

        this.outputChannel.appendLine(`Launched CPU profiler: ${command}`);

        let resultMessage = `CPU profiler (${profiler.name}) launched. `;
        if (profiler.name === 'perf') {
            resultMessage += 'Run "perf report" after the app exits to view results.';
        } else if (profiler.name === 'Instruments') {
            resultMessage += 'Results will open in Instruments when the trace completes.';
        } else if (profiler.name === 'VTune') {
            resultMessage += 'Run "vtune -report hotspots" after collection finishes.';
        }

        void vscode.window.showInformationMessage(resultMessage);
    }

    // ─────────────────────────────────────────────────────────────
    // Memory Leak Detection
    // ─────────────────────────────────────────────────────────────

    async launchMemoryProfiler(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const executable = await this.findBuiltExecutable(workspaceFolder.uri.fsPath);
        if (!executable) {
            void vscode.window.showErrorMessage('No built executable found. Build the project first.');
            return;
        }

        const tools = this.detectMemoryTools();
        if (tools.length === 0) {
            let hint = '';
            if (isLinux()) {
                hint = 'Install valgrind: sudo apt install valgrind';
            } else if (isWindows()) {
                hint = 'Download Dr. Memory from https://drmemory.org/';
            } else if (isMacOS()) {
                hint = 'The "leaks" tool is included with macOS.';
            }
            void vscode.window.showErrorMessage('No memory leak detector found.', hint);
            return;
        }

        const selected = await vscode.window.showQuickPick(
            tools.map(t => ({
                label: t.name,
                description: t.description,
                detail: t.command,
                tool: t
            })),
            { placeHolder: 'Select memory leak detector to launch' }
        );

        if (!selected) { return; }

        const tool = selected.tool;
        const terminal = vscode.window.createTerminal({
            name: `Qt Memory Profiler (${tool.name})`,
            cwd: workspaceFolder.uri.fsPath
        });

        let command: string;
        const exePath = quotePath(executable);

        switch (tool.name) {
            case 'valgrind':
                command = `valgrind --leak-check=full --show-leak-kinds=definite,indirect --track-origins=yes --log-file=${quotePath(path.join(workspaceFolder.uri.fsPath, 'valgrind.log'))} ${exePath}`;
                break;
            case 'Dr. Memory':
                command = `drmemory.exe -logdir ${quotePath(path.join(workspaceFolder.uri.fsPath, 'drmemory_logs'))} -- ${exePath}`;
                break;
            case 'leaks':
                command = `MallocStackLogging=1 MallocScribble=1 ${exePath}`;
                break;
            default:
                command = `${tool.command} ${exePath}`;
        }

        terminal.sendText(command);
        terminal.show();

        this.outputChannel.appendLine(`Launched memory profiler: ${command}`);

        let resultMessage = `Memory leak detector (${tool.name}) launched. `;
        if (tool.name === 'valgrind') {
            resultMessage += 'Results saved to valgrind.log in workspace root.';
        } else if (tool.name === 'Dr. Memory') {
            resultMessage += 'Results saved to drmemory_logs/ in workspace root.';
        } else if (tool.name === 'leaks') {
            resultMessage += 'After the app exits, run "leaks <pid>" or check the terminal output.';
        }

        void vscode.window.showInformationMessage(resultMessage);
    }

    // ─────────────────────────────────────────────────────────────
    // Slow Target Detection
    // ─────────────────────────────────────────────────────────────

    async detectSlowTargets(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Analyzing compilation targets...',
            cancellable: false
        }, async () => {
            // 1. Try compile_commands.json first
            let targets = await this.analyzeCompileCommands(workspaceFolder.uri.fsPath);

            // 2. Fallback to scanning .cpp files
            if (targets.length === 0) {
                targets = await this.scanCppFiles(workspaceFolder.uri.fsPath);
            }

            if (targets.length === 0) {
                void vscode.window.showWarningMessage('No C++ source files found in workspace.');
                return;
            }

            // Sort by score descending
            targets.sort((a, b) => b.score - a.score);

            const topTargets = targets.slice(0, 15);

            const items = topTargets.map(t => ({
                label: path.basename(t.file),
                description: `${t.lines} LOC, ${t.includes} includes, ${t.templates} templates`,
                detail: `Complexity score: ${t.score} | ${path.relative(workspaceFolder.uri.fsPath, t.file)}`,
                file: t.file,
                score: t.score
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Top ${items.length} slowest compilation targets (by complexity heuristic)`
            });

            if (selected) {
                const doc = await vscode.workspace.openTextDocument(selected.file);
                await vscode.window.showTextDocument(doc);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────

    private async findBuiltExecutable(workspacePath: string): Promise<string | undefined> {
        const projects = await this.qtProjectDetector.detectProjects(workspacePath);
        if (projects.length === 0) {
            return undefined;
        }

        let projectFile = projects[0];
        if (projects.length > 1) {
            const selected = await vscode.window.showQuickPick(
                projects.map(p => ({ label: path.basename(p), description: p, value: p })),
                { placeHolder: 'Select project to profile' }
            );
            if (!selected) { return undefined; }
            projectFile = selected.value;
        }

        const buildDir = this.qtConfigManager.getBuildDirectory();
        const projectInfo = await this.qtProjectDetector.getProjectInfo(projectFile);

        if (!projectInfo || projectInfo.type === 'python') {
            return undefined;
        }

        // Try to find executable in build directory
        const exePath = await this.qtProjectDetector.findExecutable(projectFile, buildDir);
        if (exePath) {
            return exePath;
        }

        // Fallback: search build directory for any executable
        return this.searchForExecutable(buildDir, projectInfo.name);
    }

    private searchForExecutable(buildDir: string, projectName: string): string | undefined {
        const searchPaths = [
            buildDir,
            path.join(buildDir, 'debug'),
            path.join(buildDir, 'release'),
            path.join(buildDir, 'Debug'),
            path.join(buildDir, 'Release')
        ];

        for (const dir of searchPaths) {
            if (!fs.existsSync(dir)) { continue; }

            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isFile()) { continue; }
                    const fullPath = path.join(dir, entry.name);

                    // On Windows, check .exe
                    if (isWindows()) {
                        if (entry.name.toLowerCase().endsWith('.exe') &&
                            !entry.name.toLowerCase().includes('test') &&
                            (entry.name.toLowerCase().startsWith(projectName.toLowerCase()) ||
                             entry.name.toLowerCase() === `${projectName.toLowerCase()}.exe`)) {
                            return fullPath;
                        }
                    } else {
                        // On Unix, check executable permission
                        try {
                            const stats = fs.statSync(fullPath);
                            const isExecutable = (stats.mode & 0o111) !== 0;
                            if (isExecutable && !entry.name.includes('.') &&
                                (entry.name.toLowerCase().startsWith(projectName.toLowerCase()))) {
                                return fullPath;
                            }
                        } catch {
                            // ignore
                        }
                    }
                }
            } catch {
                // ignore
            }
        }

        return undefined;
    }

    private detectCpuProfilers(): ProfilerInfo[] {
        const profilers: ProfilerInfo[] = [];

        if (isLinux()) {
            try {
                execSync('which perf', { encoding: 'utf-8', stdio: 'pipe' });
                profilers.push({
                    name: 'perf',
                    command: 'perf',
                    description: 'Linux perf profiler (requires kernel support)',
                    installHint: 'sudo apt install linux-tools-generic'
                });
            } catch {
                // not installed
            }
        }

        if (isMacOS()) {
            try {
                // Check for Instruments
                const xcodePath = execSync('xcode-select -p', { encoding: 'utf-8', stdio: 'pipe' }).trim();
                if (xcodePath && fs.existsSync('/usr/bin/instruments')) {
                    profilers.push({
                        name: 'Instruments',
                        command: 'instruments',
                        description: 'Xcode Instruments (Time Profiler)',
                        installHint: 'Install Xcode from the App Store'
                    });
                }
            } catch {
                // not installed
            }

            // sample is always available on macOS
            profilers.push({
                name: 'sample',
                command: 'sample',
                description: 'macOS sample command (lightweight profiler)',
                installHint: 'Built-in to macOS'
            });
        }

        if (isWindows() || isLinux()) {
            try {
                execSync('which vtune', { encoding: 'utf-8', stdio: 'pipe' });
                profilers.push({
                    name: 'VTune',
                    command: 'vtune',
                    description: 'Intel VTune Profiler',
                    installHint: 'Download from https://www.intel.com/content/www/us/en/developer/tools/oneapi/vtune-profiler.html'
                });
            } catch {
                // not installed
            }
        }

        return profilers;
    }

    private detectMemoryTools(): ProfilerInfo[] {
        const tools: ProfilerInfo[] = [];

        if (isLinux()) {
            try {
                execSync('which valgrind', { encoding: 'utf-8', stdio: 'pipe' });
                tools.push({
                    name: 'valgrind',
                    command: 'valgrind',
                    description: 'Comprehensive memory error detector',
                    installHint: 'sudo apt install valgrind'
                });
            } catch {
                // not installed
            }
        }

        if (isWindows()) {
            try {
                execSync('where drmemory', { encoding: 'utf-8', stdio: 'pipe' });
                tools.push({
                    name: 'Dr. Memory',
                    command: 'drmemory',
                    description: 'Memory monitoring tool for Windows',
                    installHint: 'Download from https://drmemory.org/'
                });
            } catch {
                // not installed
            }
        }

        if (isMacOS()) {
            // leaks command is always available
            tools.push({
                name: 'leaks',
                command: 'leaks',
                description: 'macOS memory leak detection via MallocStackLogging',
                installHint: 'Built-in to macOS'
            });
        }

        return tools;
    }

    private findQtCreator(qtInstallation: QtInstallation): string | undefined {
        const binDir = path.join(qtInstallation.path, 'bin');
        const possibleNames = ['qtcreator', 'Qt Creator'];
        for (const name of possibleNames) {
            const p = path.join(binDir, exe(name));
            if (fs.existsSync(p)) {
                return p;
            }
        }

        // macOS app bundle
        if (isMacOS()) {
            const appPath = path.join(qtInstallation.path, 'Qt Creator.app', 'Contents', 'MacOS', 'Qt Creator');
            if (fs.existsSync(appPath)) {
                return appPath;
            }
        }

        return undefined;
    }

    private async analyzeCompileCommands(workspacePath: string): Promise<SlowTarget[]> {
        const compileCommandsPath = path.join(workspacePath, 'compile_commands.json');
        if (!fs.existsSync(compileCommandsPath)) {
            // Try build directory
            const buildDir = this.qtConfigManager.getBuildDirectory();
            const altPath = path.join(buildDir, 'compile_commands.json');
            if (!fs.existsSync(altPath)) {
                return [];
            }
            return this.parseCompileCommands(altPath);
        }
        return this.parseCompileCommands(compileCommandsPath);
    }

    private parseCompileCommands(filePath: string): SlowTarget[] {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const commands: Array<{ file: string; directory: string }> = JSON.parse(content);
            const targets: SlowTarget[] = [];
            const seen = new Set<string>();

            for (const entry of commands) {
                const cppFile = entry.file;
                if (seen.has(cppFile)) { continue; }
                seen.add(cppFile);

                if (fs.existsSync(cppFile)) {
                    const target = this.analyzeCppFile(cppFile);
                    if (target) {
                        targets.push(target);
                    }
                }
            }

            return targets;
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing compile_commands.json: ${error}`);
            return [];
        }
    }

    private async scanCppFiles(workspacePath: string): Promise<SlowTarget[]> {
        const uris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspacePath, '**/*.cpp'),
            '**/build/**,**/out/**,**/.git/**,**/node_modules/**'
        );

        const targets: SlowTarget[] = [];
        for (const uri of uris) {
            const target = this.analyzeCppFile(uri.fsPath);
            if (target) {
                targets.push(target);
            }
        }

        return targets;
    }

    private analyzeCppFile(filePath: string): SlowTarget | undefined {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n').length;

            // Count #include statements
            const includes = (content.match(/^#include/gim) || []).length;

            // Count template usage indicators
            const templates = (content.match(/template\s*<|std::vector<|std::map<|std::unique_ptr<|QList<|QVector<|QMap</g) || []).length;

            // Heuristic score: weighted combination
            const score = lines + (includes * 50) + (templates * 30);

            return {
                file: filePath,
                lines,
                includes,
                templates,
                score
            };
        } catch {
            return undefined;
        }
    }
}

function quotePath(p: string): string {
    return `"${p}"`;
}
