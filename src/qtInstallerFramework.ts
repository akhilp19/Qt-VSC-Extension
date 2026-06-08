import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { exe, pathExeLookupCmd } from './platformUtils';

export class QtInstallerFramework {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    // ========================================================================
    // Config Generation
    // ========================================================================

    async generateInstallerConfig(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        const projectInfo = this.detectProjectInfo(workspaceFolder.uri.fsPath);
        const defaultName = projectInfo?.name || 'MyApp';

        const installerName = await vscode.window.showInputBox({
            prompt: 'Installer name',
            value: defaultName,
            validateInput: (v) => v && v.trim().length > 0 ? null : 'Name is required'
        });
        if (!installerName) { return; }

        const version = await vscode.window.showInputBox({
            prompt: 'Application version',
            value: '1.0.0',
            validateInput: (v) => /^\d+\.\d+\.\d+/.test(v || '') ? null : 'Use semantic versioning (e.g., 1.0.0)'
        });
        if (!version) { return; }

        const publisher = await vscode.window.showInputBox({
            prompt: 'Publisher name (optional)',
            value: ''
        });

        const targetDir = await vscode.window.showInputBox({
            prompt: 'Installer config directory',
            value: 'installer'
        });
        if (!targetDir) { return; }

        const installerRoot = path.join(workspaceFolder.uri.fsPath, targetDir);
        const configDir = path.join(installerRoot, 'config');
        const packageId = `com.yourcompany.${installerName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const packageDir = path.join(installerRoot, 'packages', packageId);
        const metaDir = path.join(packageDir, 'meta');
        const dataDir = path.join(packageDir, 'data');

        // Create directories
        fs.mkdirSync(configDir, { recursive: true });
        fs.mkdirSync(metaDir, { recursive: true });
        fs.mkdirSync(dataDir, { recursive: true });

        // Generate config.xml
        const configXml = this.buildConfigXml(installerName, version, publisher || '');
        fs.writeFileSync(path.join(configDir, 'config.xml'), configXml, 'utf-8');

        // Generate package.xml
        const packageXml = this.buildPackageXml(installerName, version);
        fs.writeFileSync(path.join(metaDir, 'package.xml'), packageXml, 'utf-8');

        this.outputChannel.appendLine(`[Installer] Generated IFW config in ${installerRoot}`);

        const result = await vscode.window.showInformationMessage(
            `Installer config generated in ${targetDir}/`,
            'Open Folder',
            'Show Instructions'
        );

        if (result === 'Open Folder') {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(configDir, 'config.xml')));
            await vscode.window.showTextDocument(doc);
        } else if (result === 'Show Instructions') {
            const instructions = [
                `1. Build your Qt application in Release mode`,
                `2. Copy built binaries to: ${targetDir}/packages/${packageId}/data/`,
                `3. Run "Qt: Build Installer" to create the installer executable`
            ].join('\n');
            void vscode.window.showInformationMessage(instructions, { modal: true, detail: 'Next steps' }, 'OK');
        }
    }

    // ========================================================================
    // Installer Build
    // ========================================================================

    async buildInstaller(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        const binaryCreator = await this.findBinaryCreator();
        if (!binaryCreator) {
            const result = await vscode.window.showInformationMessage(
                'binarycreator not found. Qt Installer Framework is required.',
                'Download IFW',
                'Cancel'
            );
            if (result === 'Download IFW') {
                await vscode.env.openExternal(vscode.Uri.parse('https://doc.qt.io/qtinstallerframework/'));
            }
            return;
        }

        // Find config.xml
        const configPath = path.join(workspaceFolder.uri.fsPath, 'installer', 'config', 'config.xml');
        if (!fs.existsSync(configPath)) {
            const result = await vscode.window.showInformationMessage(
                'Installer config not found. Generate it first?',
                'Generate Config',
                'Cancel'
            );
            if (result === 'Generate Config') {
                await this.generateInstallerConfig();
            }
            return;
        }

        // Parse config.xml for name and version
        let installerName = 'MyApp';
        let version = '1.0.0';
        try {
            const configContent = fs.readFileSync(configPath, 'utf-8');
            const nameMatch = configContent.match(/<Name>([^<]+)<\/Name>/);
            const verMatch = configContent.match(/<Version>([^<]+)<\/Version>/);
            if (nameMatch) { installerName = nameMatch[1]; }
            if (verMatch) { version = verMatch[1]; }
        } catch {
            // ignore
        }

        // Determine output extension
        let ext: string;
        if (process.platform === 'win32') {
            ext = '.exe';
        } else if (process.platform === 'darwin') {
            ext = '.dmg';
        } else {
            ext = '.run';
        }

        const outputName = `${installerName}-${version}${ext}`;
        const outputPath = path.join(workspaceFolder.uri.fsPath, outputName);
        const packagesDir = path.join(workspaceFolder.uri.fsPath, 'installer', 'packages');

        this.outputChannel.appendLine(`[Installer] Building: ${binaryCreator} -c "${configPath}" -p "${packagesDir}" "${outputPath}"`);
        void vscode.window.setStatusBarMessage(`$(sync~spin) Building installer...`, 10000);

        try {
            execSync(`"${binaryCreator}" -c "${configPath}" -p "${packagesDir}" "${outputPath}"`, {
                encoding: 'utf-8',
                cwd: workspaceFolder.uri.fsPath,
                stdio: 'pipe'
            });

            this.outputChannel.appendLine(`[Installer] Created: ${outputPath}`);
            void vscode.window.showInformationMessage(
                `Installer created: ${outputName}`,
                'Open Folder',
                'OK'
            ).then(choice => {
                if (choice === 'Open Folder') {
                    void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputPath));
                }
            });
        } catch (error) {
            this.outputChannel.appendLine(`[Installer] Error: ${error}`);
            void vscode.window.showErrorMessage(`Failed to build installer: ${String(error)}`);
        }
    }

    // ========================================================================
    // Tool Discovery
    // ========================================================================

    private async findBinaryCreator(): Promise<string | undefined> {
        // 1. Search in Qt Tools/QtInstallerFramework
        const qtConfigManager = new QtConfigManager(this.outputChannel);
        const qtInstallation = await qtConfigManager.getQtInstallation();

        if (qtInstallation?.path) {
            const toolsDir = path.join(qtInstallation.path, 'Tools');
            if (fs.existsSync(toolsDir)) {
                const ifwDir = this.findIfwDir(toolsDir);
                if (ifwDir) {
                    const bcPath = path.join(ifwDir, 'bin', exe('binarycreator'));
                    if (fs.existsSync(bcPath)) {
                        return bcPath;
                    }
                }
            }

            // Also check parent of Qt installation (common structure: C:/Qt/Tools/)
            const parentToolsDir = path.join(path.dirname(qtInstallation.path), 'Tools');
            if (fs.existsSync(parentToolsDir)) {
                const ifwDir = this.findIfwDir(parentToolsDir);
                if (ifwDir) {
                    const bcPath = path.join(ifwDir, 'bin', exe('binarycreator'));
                    if (fs.existsSync(bcPath)) {
                        return bcPath;
                    }
                }
            }
        }

        // 2. Check PATH
        try {
            const lookupCmd = pathExeLookupCmd('binarycreator');
            const result = execSync(lookupCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            const firstLine = result.split('\n')[0].trim();
            if (firstLine && fs.existsSync(firstLine)) {
                return firstLine;
            }
        } catch {
            // not found
        }

        return undefined;
    }

    private findIfwDir(toolsDir: string): string | undefined {
        try {
            const entries = fs.readdirSync(toolsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.toLowerCase().startsWith('qtinstallerframework')) {
                    const fullPath = path.join(toolsDir, entry.name);
                    // Look for the highest version
                    const versionDirs = fs.readdirSync(fullPath, { withFileTypes: true })
                        .filter(e => e.isDirectory() && /^\d+/.test(e.name))
                        .map(e => e.name)
                        .sort((a, b) => parseFloat(b) - parseFloat(a));

                    if (versionDirs.length > 0) {
                        return path.join(fullPath, versionDirs[0]);
                    }
                    return fullPath;
                }
            }
        } catch {
            // ignore
        }
        return undefined;
    }

    // ========================================================================
    // Project Detection
    // ========================================================================

    private detectProjectInfo(workspacePath: string): { name: string; type: 'qmake' | 'cmake' } | undefined {
        try {
            const entries = fs.readdirSync(workspacePath);
            for (const entry of entries) {
                if (entry.endsWith('.pro')) {
                    return { name: path.basename(entry, '.pro'), type: 'qmake' };
                }
            }
            if (entries.includes('CMakeLists.txt')) {
                return { name: path.basename(workspacePath), type: 'cmake' };
            }
        } catch {
            // ignore
        }
        return undefined;
    }

    // ========================================================================
    // XML Builders
    // ========================================================================

    private buildConfigXml(name: string, version: string, publisher: string): string {
        const safeName = name.replace(/[<>"'&]/g, '');
        const safePublisher = publisher.replace(/[<>"'&]/g, '');
        const dateStr = new Date().toISOString().split('T')[0];

        const lines: string[] = [];
        lines.push('<?xml version="1.0" encoding="UTF-8"?>');
        lines.push('<Installer>');
        lines.push(`    <Name>${safeName}</Name>`);
        lines.push(`    <Version>${version}</Version>`);
        lines.push(`    <Title>${safeName} Installer</Title>`);
        if (safePublisher) {
            lines.push(`    <Publisher>${safePublisher}</Publisher>`);
        }
        lines.push(`    <StartMenuDir>${safeName}</StartMenuDir>`);
        lines.push(`    <TargetDir>@HomeDir@/${safeName}</TargetDir>`);
        lines.push(`    <MaintenanceToolName>${safeName}MaintenanceTool</MaintenanceToolName>`);
        lines.push(`    <AllowSpaceInPath>true</AllowSpaceInPath>`);
        lines.push(`    <AllowNonAsciiCharacters>true</AllowNonAsciiCharacters>`);
        lines.push('</Installer>');
        lines.push('');
        return lines.join('\n');
    }

    private buildPackageXml(name: string, version: string): string {
        const safeName = name.replace(/[<>"'&]/g, '');
        const dateStr = new Date().toISOString().split('T')[0];

        const lines: string[] = [];
        lines.push('<?xml version="1.0" encoding="UTF-8"?>');
        lines.push('<Package>');
        lines.push(`    <DisplayName>${safeName}</DisplayName>`);
        lines.push(`    <Description>${safeName} Application</Description>`);
        lines.push(`    <Version>${version}</Version>`);
        lines.push(`    <ReleaseDate>${dateStr}</ReleaseDate>`);
        lines.push('    <Default>true</Default>');
        lines.push('    <ForcedInstallation>true</ForcedInstallation>');
        lines.push('</Package>');
        lines.push('');
        return lines.join('\n');
    }
}
