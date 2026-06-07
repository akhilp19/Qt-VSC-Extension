import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface QtCreatorBuildConfig {
    name: string;
    buildDirectory: string;
    qmakeArgs: string;
    makeArgs: string;
}

interface QtCreatorImportResult {
    buildConfigs: QtCreatorBuildConfig[];
    runConfiguration?: {
        executable: string;
        workingDirectory: string;
        arguments: string;
    };
}

export class QtCreatorImporter {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Import Qt Creator settings for a given .pro file.
     */
    async importProUser(projectFile: string): Promise<QtCreatorImportResult | undefined> {
        const proUserFile = `${projectFile}.user`;
        if (!fs.existsSync(proUserFile)) {
            void vscode.window.showInformationMessage(
                `No Qt Creator settings found for ${path.basename(projectFile)}. Looking for ${path.basename(proUserFile)}.`
            );
            return undefined;
        }

        try {
            const content = fs.readFileSync(proUserFile, 'utf-8');
            return this.parseProUserXml(content, projectFile);
        } catch (error) {
            this.outputChannel.appendLine(`Error parsing .pro.user: ${error}`);
            void vscode.window.showErrorMessage(`Failed to parse Qt Creator settings: ${String(error)}`);
            return undefined;
        }
    }

    /**
     * Parse Qt Creator .pro.user XML content.
     */
    private parseProUserXml(content: string, projectFile: string): QtCreatorImportResult {
        const result: QtCreatorImportResult = { buildConfigs: [] };

        // Simple regex-based parsing for key-value entries in .pro.user
        // Qt Creator .pro.user files are XML with <data> elements

        // Extract build configurations
        const buildDirMatches = content.matchAll(/<value[^>]*type="QString"[^>]*>([^<]*)<\/value>/gi);
        const buildDirs: string[] = [];
        for (const match of buildDirMatches) {
            const val = match[1];
            if (val.includes('build') || val.includes('Build')) {
                buildDirs.push(val);
            }
        }

        // Extract qmake arguments
        const qmakeArgMatches = content.matchAll(/<value[^>]*type="QString"[^>]*>([^<]*)<\/value>/gi);
        const qmakeArgs: string[] = [];
        for (const match of qmakeArgMatches) {
            const val = match[1];
            if (val.includes('qmake') || val.includes('CONFIG')) {
                qmakeArgs.push(val);
            }
        }

        // Try to find build steps more specifically
        const buildStepRegex = /<data>\s*<variable>BuildConfiguration\.(\d+)\.BuildDirectory<\/variable>\s*<value[^>]*>([^<]*)<\/value>/gi;
        let buildMatch;
        while ((buildMatch = buildStepRegex.exec(content)) !== null) {
            result.buildConfigs.push({
                name: `Config ${buildMatch[1]}`,
                buildDirectory: this.expandQtCreatorPath(buildMatch[2], projectFile),
                qmakeArgs: '',
                makeArgs: ''
            });
        }

        // If regex didn't find structured data, fall back to simple extraction
        if (result.buildConfigs.length === 0 && buildDirs.length > 0) {
            result.buildConfigs.push({
                name: 'Imported from Qt Creator',
                buildDirectory: this.expandQtCreatorPath(buildDirs[0], projectFile),
                qmakeArgs: qmakeArgs[0] || '',
                makeArgs: ''
            });
        }

        this.outputChannel.appendLine(`[QtCreatorImport] Found ${result.buildConfigs.length} build config(s)`);
        return result;
    }

    /**
     * Expand Qt Creator path placeholders.
     */
    private expandQtCreatorPath(qtcPath: string, projectFile: string): string {
        const projectDir = path.dirname(projectFile);
        return qtcPath
            .replace('%{sourceDir}', projectDir)
            .replace('%{buildDir}', path.join(projectDir, 'build'))
            .replace('%{Project:Name}', path.basename(projectFile, '.pro'));
    }

    /**
     * Check if a .qbs file exists and parse basic info.
     */
    async parseQbsFile(projectDir: string): Promise<{ name: string; files: string[] } | undefined> {
        const qbsFiles = fs.readdirSync(projectDir)
            .filter(f => f.endsWith('.qbs'))
            .map(f => path.join(projectDir, f));

        if (qbsFiles.length === 0) {
            return undefined;
        }

        const qbsFile = qbsFiles[0];
        try {
            const content = fs.readFileSync(qbsFile, 'utf-8');
            const nameMatch = content.match(/name:\s*"([^"]+)"/);
            const fileMatches = content.matchAll(/"([^"]+\.(?:cpp|h|hpp|c))"/gi);
            const files: string[] = [];
            for (const match of fileMatches) {
                files.push(match[1]);
            }

            return {
                name: nameMatch?.[1] || path.basename(qbsFile, '.qbs'),
                files
            };
        } catch {
            return undefined;
        }
    }

    /**
     * Show import results to user.
     */
    async showImportResults(projectFile: string): Promise<void> {
        const result = await this.importProUser(projectFile);

        if (!result || result.buildConfigs.length === 0) {
            return;
        }

        const items = result.buildConfigs.map(cfg => ({
            label: cfg.name,
            description: cfg.buildDirectory,
            detail: `QMake: ${cfg.qmakeArgs || 'none'} | Make: ${cfg.makeArgs || 'none'}`,
            config: cfg
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select Qt Creator build configuration to import'
        });

        if (!selected) {
            return;
        }

        // Apply the imported settings
        const config = vscode.workspace.getConfiguration('qt');
        await config.update('buildDirectory', selected.config.buildDirectory, vscode.ConfigurationTarget.Workspace);

        if (selected.config.qmakeArgs) {
            await config.update('additionalQMakeArguments', selected.config.qmakeArgs, vscode.ConfigurationTarget.Workspace);
        }

        void vscode.window.showInformationMessage(
            `Imported Qt Creator config: ${selected.label}`,
            'Open Settings'
        ).then(choice => {
            if (choice === 'Open Settings') {
                void vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'qt');
            }
        });

        this.outputChannel.appendLine(`[QtCreatorImport] Imported config: ${selected.label} → ${selected.config.buildDirectory}`);
    }
}
