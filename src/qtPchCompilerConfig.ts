import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QtConfigManager } from './qtConfigManager';

type CompilerFamily = 'msvc' | 'gcc' | 'clang' | 'unknown';

export class QtPchCompilerConfig {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    // ========================================================================
    // Main Entry Point
    // ========================================================================

    async configurePchCompiler(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        const pchPath = path.join(workspaceFolder.uri.fsPath, 'qt_pch.h');
        if (!fs.existsSync(pchPath)) {
            const result = await vscode.window.showInformationMessage(
                'qt_pch.h not found. Generate it first?',
                'Generate PCH',
                'Cancel'
            );
            if (result === 'Generate PCH') {
                await vscode.commands.executeCommand('qt.generatePch');
            }
            return;
        }

        const compiler = await this.detectCompilerFamily();

        const method = await vscode.window.showQuickPick(
            [
                {
                    label: 'VS Code Settings',
                    description: 'Updates C_Cpp.default.compilerArgs (affects IntelliSense + build)',
                    value: 'settings'
                },
                {
                    label: 'Build Tasks',
                    description: 'Updates .vscode/tasks.json with PCH env vars (build only)',
                    value: 'tasks'
                }
            ],
            { placeHolder: 'Choose how to configure PCH compiler flags' }
        );
        if (!method) { return; }

        if (method.value === 'settings') {
            await this.configurePchViaSettings(workspaceFolder.uri.fsPath, compiler);
        } else {
            await this.configurePchViaTasks(workspaceFolder.uri.fsPath, compiler);
        }
    }

    // ========================================================================
    // Settings-Based Configuration
    // ========================================================================

    async configurePchViaSettings(workspacePath: string, compiler: CompilerFamily): Promise<void> {
        const args = this.getPchCompilerArgs(compiler);
        if (!args) {
            void vscode.window.showWarningMessage('Could not determine PCH flags for this compiler');
            return;
        }

        // Try c_cpp_properties.json first
        const cppPropsPath = path.join(workspacePath, '.vscode', 'c_cpp_properties.json');
        if (fs.existsSync(cppPropsPath)) {
            await this.updateCppProperties(cppPropsPath, args);
            void vscode.window.showInformationMessage(
                'PCH compiler flags added to c_cpp_properties.json',
                'Open File'
            ).then(choice => {
                if (choice === 'Open File') {
                    void vscode.workspace.openTextDocument(vscode.Uri.file(cppPropsPath)).then(doc => {
                        void vscode.window.showTextDocument(doc);
                    });
                }
            });
            return;
        }

        // Fallback to settings.json
        const settingsPath = path.join(workspacePath, '.vscode', 'settings.json');
        await this.updateSettingsJson(settingsPath, args);
        void vscode.window.showInformationMessage(
            'PCH compiler flags added to settings.json',
            'Open File'
        ).then(choice => {
            if (choice === 'Open File') {
                void vscode.workspace.openTextDocument(vscode.Uri.file(settingsPath)).then(doc => {
                    void vscode.window.showTextDocument(doc);
                });
            }
        });
    }

    private async updateCppProperties(cppPropsPath: string, args: string[]): Promise<void> {
        const content = fs.readFileSync(cppPropsPath, 'utf-8');
        const config = JSON.parse(content);

        if (!config.configurations || !Array.isArray(config.configurations)) {
            config.configurations = [{}];
        }

        for (const cfg of config.configurations) {
            const existing = cfg.compilerArgs || [];
            const merged = Array.from(new Set([...existing, ...args]));
            cfg.compilerArgs = merged;
        }

        fs.writeFileSync(cppPropsPath, JSON.stringify(config, null, 4), 'utf-8');
        this.outputChannel.appendLine(`[PCH] Updated compilerArgs in ${cppPropsPath}`);
    }

    private async updateSettingsJson(settingsPath: string, args: string[]): Promise<void> {
        let config: Record<string, unknown> = {};
        if (fs.existsSync(settingsPath)) {
            const content = fs.readFileSync(settingsPath, 'utf-8');
            try {
                config = JSON.parse(content);
            } catch {
                config = {};
            }
        }

        const existing = (config['C_Cpp.default.compilerArgs'] as string[]) || [];
        const merged = Array.from(new Set([...existing, ...args]));
        config['C_Cpp.default.compilerArgs'] = merged;

        const vscodeDir = path.dirname(settingsPath);
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        fs.writeFileSync(settingsPath, JSON.stringify(config, null, 4), 'utf-8');
        this.outputChannel.appendLine(`[PCH] Updated C_Cpp.default.compilerArgs in ${settingsPath}`);
    }

    // ========================================================================
    // Task-Based Configuration
    // ========================================================================

    async configurePchViaTasks(workspacePath: string, compiler: CompilerFamily): Promise<void> {
        const tasksPath = path.join(workspacePath, '.vscode', 'tasks.json');
        let tasksConfig: { version?: string; tasks?: Array<Record<string, unknown>> } = {};

        if (fs.existsSync(tasksPath)) {
            const content = fs.readFileSync(tasksPath, 'utf-8');
            try {
                tasksConfig = JSON.parse(content);
            } catch {
                tasksConfig = {};
            }
        }

        if (!tasksConfig.tasks) {
            tasksConfig.tasks = [];
        }
        if (!tasksConfig.version) {
            tasksConfig.version = '2.0.0';
        }

        // Find Qt build tasks
        const qtTasks = tasksConfig.tasks.filter(t =>
            t.type === 'qt' && (t.task === 'build' || t.label?.toString().includes('Build'))
        );

        if (qtTasks.length === 0) {
            void vscode.window.showWarningMessage(
                'No Qt build tasks found in tasks.json. Use Settings-based configuration instead?',
                'Use Settings',
                'Cancel'
            ).then(choice => {
                if (choice === 'Use Settings') {
                    void this.configurePchViaSettings(workspacePath, compiler);
                }
            });
            return;
        }

        const envPrefix = this.getPchEnvPrefix(compiler);
        for (const task of qtTasks) {
            if (!task.options) {
                task.options = {};
            }
            const options = task.options as Record<string, unknown>;
            if (!options.env) {
                options.env = {};
            }
            const env = options.env as Record<string, string>;
            env[envPrefix.key] = envPrefix.value;
        }

        const vscodeDir = path.dirname(tasksPath);
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        fs.writeFileSync(tasksPath, JSON.stringify(tasksConfig, null, 4), 'utf-8');
        this.outputChannel.appendLine(`[PCH] Updated env vars in ${tasksPath}`);
        void vscode.window.showInformationMessage(
            `PCH environment variable (${envPrefix.key}) added to ${qtTasks.length} build task(s)`,
            'Open File'
        ).then(choice => {
            if (choice === 'Open File') {
                void vscode.workspace.openTextDocument(vscode.Uri.file(tasksPath)).then(doc => {
                    void vscode.window.showTextDocument(doc);
                });
            }
        });
    }

    // ========================================================================
    // Compiler Detection
    // ========================================================================

    private async detectCompilerFamily(): Promise<CompilerFamily> {
        const qtConfigManager = new QtConfigManager(this.outputChannel);
        const qtInstallation = await qtConfigManager.getQtInstallation();

        if (qtInstallation?.compiler) {
            const c = qtInstallation.compiler.toLowerCase();
            if (c.includes('msvc')) { return 'msvc'; }
            if (c.includes('clang')) { return 'clang'; }
            if (c.includes('gcc') || c.includes('mingw')) { return 'gcc'; }
        }

        // Fallback: check qmake spec
        if (qtInstallation?.qmakePath) {
            try {
                const { execSync } = await import('child_process');
                const spec = execSync(`"${qtInstallation.qmakePath}" -query QMAKE_XSPEC`, { encoding: 'utf-8' }).trim();
                if (spec.includes('msvc')) { return 'msvc'; }
                if (spec.includes('clang')) { return 'clang'; }
                if (spec.includes('g++') || spec.includes('gcc')) { return 'gcc'; }
            } catch {
                // ignore
            }
        }

        // Platform fallback
        if (process.platform === 'win32') { return 'msvc'; }
        return 'gcc';
    }

    private getPchCompilerArgs(compiler: CompilerFamily): string[] | undefined {
        switch (compiler) {
            case 'msvc':
                return ['/Yuqt_pch.h', '/FIqt_pch.h'];
            case 'gcc':
            case 'clang':
                return ['-include', 'qt_pch.h'];
            default:
                return undefined;
        }
    }

    private getPchEnvPrefix(compiler: CompilerFamily): { key: string; value: string } {
        switch (compiler) {
            case 'msvc':
                return { key: 'CL', value: '/Yuqt_pch.h /FIqt_pch.h' };
            case 'gcc':
            case 'clang':
                return { key: 'CXXFLAGS', value: '-include qt_pch.h' };
            default:
                return { key: 'CXXFLAGS', value: '-include qt_pch.h' };
        }
    }
}
