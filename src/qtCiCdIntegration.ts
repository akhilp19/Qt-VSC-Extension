import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    CiOptions,
    PlatformConfig,
    DEFAULT_PLATFORMS,
    KNOWN_QT_VERSIONS,
    detectProjectFile,
    generateGitHubBuildYml,
    generateGitHubReleaseYml,
    generateGitLabCiYml
} from './ciTemplates';

export class QtCiCdIntegration {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    // ========================================================================
    // Main Entry Point
    // ========================================================================

    async setupCiCd(): Promise<void> {
        const choice = await vscode.window.showQuickPick(
            [
                { label: 'GitHub Actions — Build Workflow', description: 'Generate .github/workflows/build.yml', value: 'github-build' },
                { label: 'GitHub Actions — Release Workflow', description: 'Generate .github/workflows/release.yml', value: 'github-release' },
                { label: 'GitLab CI', description: 'Generate .gitlab-ci.yml', value: 'gitlab' }
            ],
            { placeHolder: 'Select CI/CD pipeline to generate' }
        );
        if (!choice) { return; }

        switch (choice.value) {
            case 'github-build':
                await this.generateGitHubBuildWorkflow();
                break;
            case 'github-release':
                await this.generateGitHubReleaseWorkflow();
                break;
            case 'gitlab':
                await this.generateGitLabCI();
                break;
        }
    }

    // ========================================================================
    // GitHub Actions Build
    // ========================================================================

    async generateGitHubBuildWorkflow(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        const projectInfo = detectProjectFile(workspaceFolder.uri.fsPath);
        if (!projectInfo) {
            void vscode.window.showErrorMessage('No .pro or CMakeLists.txt found in workspace root');
            return;
        }

        const platforms = await this.selectPlatforms();
        if (platforms.length === 0) { return; }

        const qtVersion = await this.selectQtVersion();
        if (!qtVersion) { return; }

        const options: CiOptions = {
            projectType: projectInfo.type,
            projectFile: projectInfo.file,
            projectName: projectInfo.name,
            qtVersion,
            platforms,
            qtModules: []
        };

        const content = generateGitHubBuildYml(options);
        const workflowsDir = path.join(workspaceFolder.uri.fsPath, '.github', 'workflows');
        const filePath = path.join(workflowsDir, 'build.yml');

        await this.writeWorkflowFile(filePath, content, 'GitHub Actions Build Workflow');
    }

    // ========================================================================
    // GitHub Actions Release
    // ========================================================================

    async generateGitHubReleaseWorkflow(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        const projectInfo = detectProjectFile(workspaceFolder.uri.fsPath);
        if (!projectInfo) {
            void vscode.window.showErrorMessage('No .pro or CMakeLists.txt found in workspace root');
            return;
        }

        const platforms = await this.selectPlatforms();
        if (platforms.length === 0) { return; }

        const qtVersion = await this.selectQtVersion();
        if (!qtVersion) { return; }

        const options: CiOptions = {
            projectType: projectInfo.type,
            projectFile: projectInfo.file,
            projectName: projectInfo.name,
            qtVersion,
            platforms,
            qtModules: []
        };

        const content = generateGitHubReleaseYml(options);
        const workflowsDir = path.join(workspaceFolder.uri.fsPath, '.github', 'workflows');
        const filePath = path.join(workflowsDir, 'release.yml');

        await this.writeWorkflowFile(filePath, content, 'GitHub Actions Release Workflow');
    }

    // ========================================================================
    // GitLab CI
    // ========================================================================

    async generateGitLabCI(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        const projectInfo = detectProjectFile(workspaceFolder.uri.fsPath);
        if (!projectInfo) {
            void vscode.window.showErrorMessage('No .pro or CMakeLists.txt found in workspace root');
            return;
        }

        const qtVersion = await this.selectQtVersion();
        if (!qtVersion) { return; }

        const options: CiOptions = {
            projectType: projectInfo.type,
            projectFile: projectInfo.file,
            projectName: projectInfo.name,
            qtVersion,
            platforms: [],
            qtModules: []
        };

        const content = generateGitLabCiYml(options);
        const filePath = path.join(workspaceFolder.uri.fsPath, '.gitlab-ci.yml');

        await this.writeWorkflowFile(filePath, content, 'GitLab CI Configuration');
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private async selectPlatforms(): Promise<PlatformConfig[]> {
        const items = DEFAULT_PLATFORMS.map(p => ({
            label: p.label,
            picked: true,
            value: p
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select target platforms',
            canPickMany: true
        });

        if (!selected || selected.length === 0) {
            return [];
        }

        return selected.map(s => s.value);
    }

    private async selectQtVersion(): Promise<string | undefined> {
        const items = KNOWN_QT_VERSIONS.map(v => ({
            label: `Qt ${v}`,
            value: v,
            picked: v === '6.7.0'
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select Qt version for CI'
        });

        return selected?.value;
    }

    private async writeWorkflowFile(filePath: string, content: string, description: string): Promise<void> {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (fs.existsSync(filePath)) {
            const overwrite = await vscode.window.showWarningMessage(
                `${path.basename(filePath)} already exists. Overwrite?`,
                'Overwrite',
                'Cancel'
            );
            if (overwrite !== 'Overwrite') { return; }
        }

        fs.writeFileSync(filePath, content, 'utf-8');
        this.outputChannel.appendLine(`[CI/CD] Generated ${description}: ${filePath}`);

        const result = await vscode.window.showInformationMessage(
            `Generated ${path.basename(filePath)}`,
            'Open File',
            'Open Folder'
        );

        if (result === 'Open File') {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(doc);
        } else if (result === 'Open Folder') {
            const dirUri = vscode.Uri.file(path.dirname(filePath));
            await vscode.commands.executeCommand('vscode.openFolder', dirUri);
        }
    }
}
