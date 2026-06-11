import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QtConfigManager, QtInstallation } from './qtConfigManager';

export interface BuildKit {
    name: string;
    qtPath: string;
    qmakePath: string;
    qtVersion: string;
    compiler: string;
    buildDirTemplate: string;
    envVars?: Record<string, string>;
    cmakeToolchainFile?: string;
    crossCompilePrefix?: string;
    additionalQMakeArgs?: string;
    additionalCMakeArgs?: string;
}

export class QtBuildKitManager {
    private qtConfigManager: QtConfigManager;
    private outputChannel: vscode.OutputChannel;

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
    }

    // ─────────────────────────────────────────────────────────────
    // Kit Detection
    // ─────────────────────────────────────────────────────────────

    async detectKits(): Promise<BuildKit[]> {
        const kits: BuildKit[] = [];
        const installations = await this.qtConfigManager.findQtInstallations();

        for (const inst of installations) {
            const compiler = this.inferCompiler(inst);
            const kitName = this.generateKitName(inst, compiler);
            kits.push({
                name: kitName,
                qtPath: inst.path,
                qmakePath: inst.qmakePath,
                qtVersion: inst.version || 'unknown',
                compiler,
                buildDirTemplate: '${workspaceFolder}/build-${kitName}-${buildType}',
                envVars: {},
                additionalQMakeArgs: '',
                additionalCMakeArgs: ''
            });
        }

        this.outputChannel.appendLine(`[Build Kits] Detected ${kits.length} kit(s)`);
        return kits;
    }

    async saveDetectedKits(): Promise<void> {
        const detected = await this.detectKits();
        const config = vscode.workspace.getConfiguration('qt');
        const existing = config.get<BuildKit[]>('buildKits') || [];

        // Merge: keep existing kits that aren't auto-detected, add new ones
        const existingNames = new Set(existing.map(k => k.name));
        const newKits = detected.filter(k => !existingNames.has(k.name));
        const merged = [...existing, ...newKits];

        await config.update('buildKits', merged, vscode.ConfigurationTarget.Workspace);

        if (newKits.length > 0) {
            void vscode.window.showInformationMessage(`Detected ${newKits.length} new build kit(s).`);
        } else {
            void vscode.window.showInformationMessage('No new build kits detected.');
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Kit Selection
    // ─────────────────────────────────────────────────────────────

    async selectKit(projectFile?: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');
        const kits = config.get<BuildKit[]>('buildKits') || [];

        if (kits.length === 0) {
            const choice = await vscode.window.showWarningMessage(
                'No build kits configured. Detect kits from Qt installations?',
                'Detect Kits',
                'Cancel'
            );
            if (choice === 'Detect Kits') {
                await this.saveDetectedKits();
            }
            return;
        }

        const targetProject = projectFile || await this.pickProject();
        if (!targetProject) { return; }

        const selected = await vscode.window.showQuickPick(
            kits.map(k => ({
                label: k.name,
                description: `${k.qtVersion} • ${k.compiler}`,
                detail: `Build: ${k.buildDirTemplate}`,
                kit: k
            })),
            { placeHolder: 'Select build kit for this project' }
        );

        if (!selected) { return; }

        const activeKits = config.get<Record<string, string>>('activeKit') || {};
        activeKits[targetProject] = selected.kit.name;
        await config.update('activeKit', activeKits, vscode.ConfigurationTarget.Workspace);

        void vscode.window.showInformationMessage(
            `Build kit set: ${selected.kit.name} for ${path.basename(targetProject)}`
        );
        this.outputChannel.appendLine(`[Build Kits] Active kit for ${path.basename(targetProject)}: ${selected.kit.name}`);
    }

    async configureKit(): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');
        const kits = config.get<BuildKit[]>('buildKits') || [];

        if (kits.length === 0) {
            void vscode.window.showWarningMessage('No build kits to configure. Run "Detect Build Kits" first.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            kits.map(k => ({ label: k.name, description: `${k.qtVersion} • ${k.compiler}`, kit: k })),
            { placeHolder: 'Select kit to configure' }
        );

        if (!selected) { return; }

        const kit = selected.kit;

        // Edit build directory template
        const newTemplate = await vscode.window.showInputBox({
            prompt: 'Build directory template',
            value: kit.buildDirTemplate,
            placeHolder: '${workspaceFolder}/build-${kitName}-${buildType}'
        });
        if (newTemplate !== undefined) {
            kit.buildDirTemplate = newTemplate;
        }

        // Edit additional QMake args
        const newQmakeArgs = await vscode.window.showInputBox({
            prompt: 'Additional qmake arguments for this kit',
            value: kit.additionalQMakeArgs || ''
        });
        if (newQmakeArgs !== undefined) {
            kit.additionalQMakeArgs = newQmakeArgs;
        }

        // Edit additional CMake args
        const newCmakeArgs = await vscode.window.showInputBox({
            prompt: 'Additional cmake arguments for this kit',
            value: kit.additionalCMakeArgs || ''
        });
        if (newCmakeArgs !== undefined) {
            kit.additionalCMakeArgs = newCmakeArgs;
        }

        // Edit cross-compile prefix
        const newCrossPrefix = await vscode.window.showInputBox({
            prompt: 'Cross-compile prefix (e.g., aarch64-linux-gnu-)',
            value: kit.crossCompilePrefix || ''
        });
        if (newCrossPrefix !== undefined) {
            kit.crossCompilePrefix = newCrossPrefix || undefined;
        }

        // Save back
        const updatedKits = kits.map(k => k.name === kit.name ? kit : k);
        await config.update('buildKits', updatedKits, vscode.ConfigurationTarget.Workspace);
        void vscode.window.showInformationMessage(`Kit "${kit.name}" updated.`);
    }

    // ─────────────────────────────────────────────────────────────
    // Toolchain File Management
    // ─────────────────────────────────────────────────────────────

    async configureKitToolchain(): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');
        const kits = config.get<BuildKit[]>('buildKits') || [];

        if (kits.length === 0) {
            void vscode.window.showWarningMessage('No build kits to configure. Run "Detect Build Kits" first.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            kits.map(k => ({ label: k.name, description: `${k.qtVersion} • ${k.compiler}`, kit: k })),
            { placeHolder: 'Select kit to configure toolchain' }
        );

        if (!selected) { return; }

        const kit = selected.kit;

        const fileUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Select CMake Toolchain File',
            filters: { 'CMake': ['cmake'], 'All Files': ['*'] }
        });

        if (!fileUri || !fileUri[0]) { return; }

        kit.cmakeToolchainFile = fileUri[0].fsPath;

        const updatedKits = kits.map(k => k.name === kit.name ? kit : k);
        await config.update('buildKits', updatedKits, vscode.ConfigurationTarget.Workspace);
        void vscode.window.showInformationMessage(`Toolchain file set for "${kit.name}": ${kit.cmakeToolchainFile}`);
        this.outputChannel.appendLine(`[Build Kits] Toolchain for ${kit.name}: ${kit.cmakeToolchainFile}`);
    }

    // ─────────────────────────────────────────────────────────────
    // Kit Export / Import
    // ─────────────────────────────────────────────────────────────

    async exportKits(): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');
        const kits = config.get<BuildKit[]>('buildKits') || [];

        if (kits.length === 0) {
            void vscode.window.showWarningMessage('No build kits to export. Run "Detect Build Kits" first.');
            return;
        }

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('qt-build-kits.json'),
            filters: { 'JSON': ['json'] }
        });

        if (!saveUri) { return; }

        fs.writeFileSync(saveUri.fsPath, JSON.stringify(kits, null, 2), 'utf-8');
        void vscode.window.showInformationMessage(`Exported ${kits.length} kit(s) to ${path.basename(saveUri.fsPath)}`);
        this.outputChannel.appendLine(`[Build Kits] Exported ${kits.length} kit(s) to ${saveUri.fsPath}`);
    }

    async importKits(): Promise<void> {
        const fileUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Import Build Kits',
            filters: { 'JSON': ['json'] }
        });

        if (!fileUri || !fileUri[0]) { return; }

        let imported: unknown;
        try {
            imported = JSON.parse(fs.readFileSync(fileUri[0].fsPath, 'utf-8'));
        } catch {
            void vscode.window.showErrorMessage('Failed to parse JSON file.');
            return;
        }

        if (!Array.isArray(imported)) {
            void vscode.window.showErrorMessage('Invalid kit file: expected an array of kits.');
            return;
        }

        const validKits: BuildKit[] = [];
        for (const item of imported) {
            if (typeof item === 'object' && item !== null &&
                'name' in item && typeof item.name === 'string' &&
                'qtPath' in item && typeof item.qtPath === 'string') {
                validKits.push(item as BuildKit);
            }
        }

        if (validKits.length === 0) {
            void vscode.window.showErrorMessage('No valid kits found in the file.');
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        const existing = config.get<BuildKit[]>('buildKits') || [];
        const existingNames = new Set(existing.map(k => k.name));

        let importedCount = 0;
        let skippedCount = 0;
        const merged = [...existing];

        for (const kit of validKits) {
            if (existingNames.has(kit.name)) {
                skippedCount++;
            } else {
                merged.push(kit);
                existingNames.add(kit.name);
                importedCount++;
            }
        }

        await config.update('buildKits', merged, vscode.ConfigurationTarget.Workspace);
        void vscode.window.showInformationMessage(
            `Imported ${importedCount} kit(s). Skipped ${skippedCount} duplicate(s).`
        );
        this.outputChannel.appendLine(`[Build Kits] Imported ${importedCount}, skipped ${skippedCount} from ${fileUri[0].fsPath}`);
    }

    // ─────────────────────────────────────────────────────────────
    // Kit Lookup
    // ─────────────────────────────────────────────────────────────

    getActiveKit(projectFile: string): BuildKit | undefined {
        const config = vscode.workspace.getConfiguration('qt');
        const activeKits = config.get<Record<string, string>>('activeKit') || {};
        const kitName = activeKits[projectFile];
        if (!kitName) { return undefined; }

        const kits = config.get<BuildKit[]>('buildKits') || [];
        return kits.find(k => k.name === kitName);
    }

    getBuildDirForProject(projectFile: string, buildType: string): string {
        const kit = this.getActiveKit(projectFile);
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const workspacePath = workspaceFolder?.uri.fsPath || '';

        if (kit) {
            return kit.buildDirTemplate
                .replace('${workspaceFolder}', workspacePath)
                .replace('${kitName}', kit.name.replace(/\s+/g, '_'))
                .replace('${buildType}', buildType)
                .replace('${qtVersion}', kit.qtVersion || 'unknown')
                .replace('${compiler}', kit.compiler || 'unknown');
        }

        // Fallback to global setting
        return this.qtConfigManager.getBuildDirectory();
    }

    getKitEnvVars(projectFile: string): Record<string, string> {
        const kit = this.getActiveKit(projectFile);
        return kit?.envVars || {};
    }

    getKitQMakeArgs(projectFile: string): string {
        const kit = this.getActiveKit(projectFile);
        return kit?.additionalQMakeArgs || '';
    }

    getKitCMakeArgs(projectFile: string): string {
        const kit = this.getActiveKit(projectFile);
        return kit?.additionalCMakeArgs || '';
    }

    getKitToolchainFile(projectFile: string): string | undefined {
        const kit = this.getActiveKit(projectFile);
        return kit?.cmakeToolchainFile;
    }

    getCrossCompilePrefix(projectFile: string): string | undefined {
        const kit = this.getActiveKit(projectFile);
        return kit?.crossCompilePrefix;
    }

    // ─────────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────────

    private inferCompiler(inst: QtInstallation): string {
        const lowerPath = inst.qmakePath.toLowerCase();
        if (lowerPath.includes('msvc2022')) { return 'MSVC2022'; }
        if (lowerPath.includes('msvc2019')) { return 'MSVC2019'; }
        if (lowerPath.includes('msvc2017')) { return 'MSVC2017'; }
        if (lowerPath.includes('msvc')) { return 'MSVC'; }
        if (lowerPath.includes('mingw')) { return 'MinGW'; }
        if (lowerPath.includes('gcc')) { return 'GCC'; }
        if (lowerPath.includes('clang')) { return 'Clang'; }
        if (lowerPath.includes('android')) { return 'Android'; }
        if (lowerPath.includes('wasm')) { return 'WebAssembly'; }
        if (lowerPath.includes('ios')) { return 'iOS'; }
        return inst.compiler || 'unknown';
    }

    private generateKitName(inst: QtInstallation, compiler: string): string {
        const version = inst.version || 'unknown';
        const bits = inst.qmakePath.toLowerCase().includes('_64') ? '64bit' : '32bit';
        return `Qt ${version} ${compiler} ${bits}`;
    }

    private async pickProject(): Promise<string | undefined> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return undefined; }

        const detector = new (await import('./qtProjectDetector')).QtProjectDetector(this.outputChannel);
        const projects = await detector.detectProjects(workspaceFolder.uri.fsPath);
        detector.dispose();

        if (projects.length === 0) { return undefined; }
        if (projects.length === 1) { return projects[0]; }

        const selected = await vscode.window.showQuickPick(
            projects.map(p => ({ label: path.basename(p), description: p, value: p })),
            { placeHolder: 'Select project' }
        );
        return selected?.value;
    }
}
