import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { QtConfigManager, QtInstallation } from './qtConfigManager';

interface CppConfiguration {
    name: string;
    includePath: string[];
    defines: string[];
    compilerPath?: string;
    cStandard?: string;
    cppStandard?: string;
    intelliSenseMode?: string;
    configurationProvider?: string;
}

interface CppProperties {
    configurations: CppConfiguration[];
    version: number;
}

export class IntelliSenseHelper {
    private qtConfigManager: QtConfigManager;
    private outputChannel: vscode.OutputChannel;

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
    }

    /**
     * Generate or update .vscode/c_cpp_properties.json with Qt paths.
     */
    async configureIntelliSense(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (!qtInstallation) {
            void vscode.window.showErrorMessage('No Qt installation detected. Please configure Qt path first.');
            return;
        }

        const qtPaths = await this.queryQtPaths(qtInstallation);
        if (!qtPaths) {
            void vscode.window.showErrorMessage('Failed to query Qt paths from qmake.');
            return;
        }

        const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
        const configPath = path.join(vscodeDir, 'c_cpp_properties.json');

        // Read existing or create new
        let config: CppProperties;
        if (fs.existsSync(configPath)) {
            try {
                const existing = fs.readFileSync(configPath, 'utf-8');
                config = JSON.parse(existing) as CppProperties;
            } catch {
                config = { configurations: [], version: 4 };
            }
        } else {
            config = { configurations: [], version: 4 };
        }

        // Find or create the Qt configuration
        let qtConfig = config.configurations.find(c => c.name === 'Qt');
        if (!qtConfig) {
            qtConfig = {
                name: 'Qt',
                includePath: [],
                defines: [],
                cppStandard: 'c++17'
            };
            config.configurations.push(qtConfig);
        }

        // Build include paths
        const includePaths = new Set<string>(qtConfig.includePath || []);

        // Qt headers
        if (qtPaths.headers) {
            includePaths.add(path.join(qtPaths.headers, '**').replace(/\\/g, '/'));
        }

        // Qt module-specific include paths (e.g., QtCore, QtGui, etc.)
        const moduleNames = ['QtCore', 'QtGui', 'QtWidgets', 'QtNetwork', 'QtSql', 'QtXml', 'QtTest', 'QtMultimedia'];
        for (const mod of moduleNames) {
            if (qtPaths.headers) {
                const modPath = path.join(qtPaths.headers, mod);
                if (fs.existsSync(modPath)) {
                    includePaths.add(path.join(modPath, '**').replace(/\\/g, '/'));
                }
            }
        }

        // MSVC / MinGW compiler path detection
        const compilerPath = await this.detectCompilerPath(qtInstallation);
        if (compilerPath) {
            qtConfig.compilerPath = compilerPath;
        }

        // IntelliSense mode
        if (qtInstallation.compiler?.includes('msvc')) {
            qtConfig.intelliSenseMode = 'windows-msvc-x64';
        } else if (qtInstallation.compiler?.includes('mingw') || qtInstallation.compiler?.includes('gcc')) {
            qtConfig.intelliSenseMode = 'windows-gcc-x64';
        }

        // Common Qt defines
        const defines = new Set<string>(qtConfig.defines || []);
        defines.add('QT_CORE_LIB');
        defines.add('QT_GUI_LIB');
        defines.add('QT_WIDGETS_LIB');
        defines.add('Q_COMPILER_INITIALIZER_LISTS');
        defines.add('Q_COMPILER_NULLPTR');
        defines.add('Q_COMPILER_RANGE_FOR');

        // Update configuration
        qtConfig.includePath = Array.from(includePaths);
        qtConfig.defines = Array.from(defines);
        qtConfig.cppStandard = qtConfig.cppStandard || 'c++17';

        // Ensure .vscode directory exists
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        // Write config
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8');

        this.outputChannel.appendLine(`Updated IntelliSense config: ${configPath}`);
        this.outputChannel.appendLine(`  Include paths: ${qtConfig.includePath.length}`);
        this.outputChannel.appendLine(`  Defines: ${qtConfig.defines.length}`);

        void vscode.window.showInformationMessage(
            `Qt IntelliSense configured with ${qtConfig.includePath.length} include path(s).`,
            'Open Config'
        ).then(choice => {
            if (choice === 'Open Config') {
                void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(configPath));
            }
        });
    }

    /**
     * Query Qt installation paths via qmake.
     */
    private async queryQtPaths(qtInstallation: QtInstallation): Promise<{ headers?: string; libs?: string; bins?: string } | undefined> {
        try {
            const headers = execSync(`"${qtInstallation.qmakePath}" -query QT_INSTALL_HEADERS`, { encoding: 'utf-8' }).trim();
            const libs = execSync(`"${qtInstallation.qmakePath}" -query QT_INSTALL_LIBS`, { encoding: 'utf-8' }).trim();
            const bins = execSync(`"${qtInstallation.qmakePath}" -query QT_INSTALL_BINS`, { encoding: 'utf-8' }).trim();

            return {
                headers: headers || undefined,
                libs: libs || undefined,
                bins: bins || undefined
            };
        } catch (error) {
            this.outputChannel.appendLine(`Failed to query Qt paths: ${error}`);
            return undefined;
        }
    }

    /**
     * Detect C++ compiler path from Qt installation.
     */
    private async detectCompilerPath(qtInstallation: QtInstallation): Promise<string | undefined> {
        try {
            if (qtInstallation.compiler?.includes('msvc')) {
                // Try to find cl.exe via VS Where or common paths
                const vsWherePaths = [
                    'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
                    'C:\\Program Files\\Microsoft Visual Studio\\Installer\\vswhere.exe'
                ];

                for (const vsWhere of vsWherePaths) {
                    if (fs.existsSync(vsWhere)) {
                        const result = execSync(
                            `"${vsWhere}" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`,
                            { encoding: 'utf-8' }
                        ).trim();
                        if (result) {
                            const clPath = path.join(result, 'VC', 'Tools', 'MSVC');
                            if (fs.existsSync(clPath)) {
                                const versions = fs.readdirSync(clPath);
                                if (versions.length > 0) {
                                    return path.join(clPath, versions[0], 'bin', 'Hostx64', 'x64', 'cl.exe');
                                }
                            }
                        }
                    }
                }
            } else if (qtInstallation.compiler?.includes('mingw')) {
                const binDir = path.dirname(qtInstallation.qmakePath);
                const gccPath = path.join(binDir, 'g++.exe');
                if (fs.existsSync(gccPath)) {
                    return gccPath;
                }
                // Try parent directory
                const parentGcc = path.join(path.dirname(binDir), 'bin', 'g++.exe');
                if (fs.existsSync(parentGcc)) {
                    return parentGcc;
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Compiler detection failed: ${error}`);
        }

        return undefined;
    }
}
