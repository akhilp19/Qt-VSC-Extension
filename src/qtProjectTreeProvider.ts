import * as vscode from 'vscode';
import * as path from 'path';
import { QtProjectDetector } from './qtProjectDetector';
import { QtConfigManager } from './qtConfigManager';
import { QtBuildTracker } from './qtBuildTracker';

export class QtProjectTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly projectFile: string,
        public readonly projectType: 'qmake' | 'cmake' | 'python' | 'raw'
    ) {
        super(label, collapsibleState);
        this.contextValue = 'qtProject';
        this.tooltip = projectFile;
        this.description = projectType === 'qmake' ? '(QMake)' : projectType === 'cmake' ? '(CMake)' : projectType === 'python' ? '(Python)' : '(Raw)';
        this.iconPath = new vscode.ThemeIcon('project');
    }
}

export class QtActionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        private commandId: string,
        public readonly icon: string,
        public readonly projectFile?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.command = {
            title: label,
            command: commandId,
            arguments: projectFile ? [vscode.Uri.file(projectFile)] : undefined
        } as vscode.Command;
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}

export class QtConfigItem extends vscode.TreeItem {
    constructor(
        public readonly projectFile: string,
        public readonly buildType: string
    ) {
        super(`Build Config: ${buildType.charAt(0).toUpperCase() + buildType.slice(1)}`, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'qtConfig';
        this.iconPath = new vscode.ThemeIcon('gear');
        this.command = {
            title: 'Select Build Configuration',
            command: 'qt.selectBuildConfig',
            arguments: [projectFile]
        };
        this.tooltip = 'Click to change build configuration (Debug/Release)';
    }
}

export class QtPropertyGroupItem extends vscode.TreeItem {
    constructor(public readonly projectFile: string) {
        super('Properties', vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('list-unordered');
    }
}

export class QtPropertyItem extends vscode.TreeItem {
    constructor(
        label: string,
        value: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = value;
        this.iconPath = new vscode.ThemeIcon('symbol-property');
    }
}

export class QtStatusGroupItem extends vscode.TreeItem {
    constructor(public readonly projectFile: string) {
        super('Build Status', vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('pulse');
    }
}

export class QtStatusItem extends vscode.TreeItem {
    constructor(
        label: string,
        value: string,
        icon: string,
        commandId?: string,
        projectFile?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = value;
        this.iconPath = new vscode.ThemeIcon(icon);
        if (commandId) {
            this.command = {
                title: label,
                command: commandId,
                arguments: projectFile ? [vscode.Uri.file(projectFile)] : undefined
            };
        }
    }
}

export class QtActionsGroupItem extends vscode.TreeItem {
    constructor(public readonly projectFile: string) {
        super('Actions', vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('play-circle');
    }
}

export class QtProjectTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = 
        new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;
    
    private projects: string[] = [];
    private outputChannel: vscode.OutputChannel;
    private qtProjectDetector: QtProjectDetector;
    private qtConfigManager: QtConfigManager;
    private buildTracker: QtBuildTracker;

    constructor(
        qtProjectDetector: QtProjectDetector,
        qtConfigManager: QtConfigManager,
        buildTracker: QtBuildTracker,
        outputChannel: vscode.OutputChannel
    ) {
        this.qtProjectDetector = qtProjectDetector;
        this.qtConfigManager = qtConfigManager;
        this.buildTracker = buildTracker;
        this.outputChannel = outputChannel;
        
        vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh());
        this.buildTracker.onDidUpdate(() => this._onDidChangeTreeData.fire(undefined));
        this.loadProjects();
    }
    
    private async loadProjects(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            this.projects = [];
            return;
        }
        
        const allProjects: string[] = [];
        for (const folder of workspaceFolders) {
            const projects = await this.qtProjectDetector.detectProjects(folder.uri.fsPath);
            allProjects.push(...projects);
        }
        this.projects = allProjects;
    }
    
    async getTreeItem(element: vscode.TreeItem): Promise<vscode.TreeItem> {
        return element;
    }
    
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            const children: vscode.TreeItem[] = [];
            
            for (const projectFile of this.projects) {
                const projectInfo = await this.qtProjectDetector.getProjectInfo(projectFile);
                if (projectInfo) {
                    const buildType = this.qtConfigManager.getProjectBuildType(projectFile);
                    const isBuilding = this.buildTracker.isBuilding(projectFile);
                    const lastBuild = this.buildTracker.getLastBuild(projectFile);
                    
                    let statusIcon = 'project';
                    if (isBuilding) {
                        statusIcon = 'sync~spin';
                    } else if (lastBuild) {
                        statusIcon = lastBuild.success ? 'check' : 'error';
                    }
                    
                    const projectItem = new QtProjectTreeItem(
                        projectInfo.name,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        projectFile,
                        projectInfo.type
                    );
                    projectItem.iconPath = new vscode.ThemeIcon(statusIcon);
                    
                    const tooltipLines = [
                        `Project: ${projectInfo.name}`,
                        `Type: ${projectInfo.type}`,
                        `Config: ${buildType}`,
                    ];
                    if (lastBuild) {
                        tooltipLines.push(`Last Build: ${this.buildTracker.formatTimeAgo(lastBuild.endTime)}`);
                    }
                    projectItem.tooltip = tooltipLines.join('\n');
                    
                    children.push(projectItem);
                }
            }
            
            if (children.length === 0) {
                const noProjectsItem = new vscode.TreeItem('No Qt projects found');
                noProjectsItem.iconPath = new vscode.ThemeIcon('info');
                return [noProjectsItem];
            }
            
            return children;
        }
        
        if (element instanceof QtProjectTreeItem) {
            return [
                new QtConfigItem(element.projectFile, this.qtConfigManager.getProjectBuildType(element.projectFile)),
                new QtPropertyGroupItem(element.projectFile),
                new QtStatusGroupItem(element.projectFile),
                new QtActionsGroupItem(element.projectFile)
            ];
        }
        
        if (element instanceof QtPropertyGroupItem) {
            return this.getProjectProperties(element.projectFile);
        }
        
        if (element instanceof QtStatusGroupItem) {
            return this.getProjectStatus(element.projectFile);
        }
        
        if (element instanceof QtActionsGroupItem) {
            return [
                new QtActionItem('Build', 'qt.buildProject', 'tools', element.projectFile),
                new QtActionItem('Clean', 'qt.cleanProject', 'trash', element.projectFile),
                new QtActionItem('Rebuild', 'qt.rebuildProject', 'refresh', element.projectFile),
                new QtActionItem('Run', 'qt.runProject', 'run', element.projectFile)
            ];
        }
        
        return [];
    }
    
    async getProjectProperties(projectFile: string): Promise<vscode.TreeItem[]> {
        const items: vscode.TreeItem[] = [];
        
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (qtInstallation) {
            items.push(new QtPropertyItem('Qt Version', qtInstallation.version || 'Unknown'));
            items.push(new QtPropertyItem('Qt Path', qtInstallation.path));
            items.push(new QtPropertyItem('Compiler', qtInstallation.compiler || 'Unknown'));
        } else {
            items.push(new QtPropertyItem('Qt', 'Not detected'));
        }
        
        items.push(new QtPropertyItem('Build Directory', this.qtConfigManager.getBuildDirectory()));
        
        const makeCmd = this.qtConfigManager.getMakeCommand(qtInstallation || undefined);
        items.push(new QtPropertyItem('Make Command', makeCmd));
        
        const buildType = this.qtConfigManager.getProjectBuildType(projectFile);
        items.push(new QtPropertyItem('Build Type', buildType));
        
        return items;
    }
    
    async getProjectStatus(projectFile: string): Promise<vscode.TreeItem[]> {
        const items: vscode.TreeItem[] = [];
        
        const isBuilding = this.buildTracker.isBuilding(projectFile);
        items.push(new QtStatusItem('Status', isBuilding ? 'Building...' : 'Idle', isBuilding ? 'sync~spin' : 'circle-outline'));
        
        const lastBuild = this.buildTracker.getLastBuild(projectFile);
        if (lastBuild) {
            items.push(new QtStatusItem('Last Build', this.buildTracker.formatTimeAgo(lastBuild.endTime), 'clock'));
            items.push(new QtStatusItem('Result', lastBuild.success ? 'Success' : 'Failed', lastBuild.success ? 'check' : 'error', 'qt.rebuildProject', projectFile));
            items.push(new QtStatusItem('Task', lastBuild.taskType, 'symbol-method'));
        } else {
            items.push(new QtStatusItem('Last Build', 'Never', 'dash'));
        }
        
        return items;
    }
    
    async refresh(): Promise<void> {
        await this.loadProjects();
        this._onDidChangeTreeData.fire(undefined);
    }
    
    collapseAll(): void {
        this.refresh();
    }
}
