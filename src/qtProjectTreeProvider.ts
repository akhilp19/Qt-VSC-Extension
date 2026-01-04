import * as vscode from 'vscode';
import * as path from 'path';
import { QtProjectDetector } from './qtProjectDetector';
import { QtConfigManager } from './qtConfigManager';

export class QtProjectTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly projectFile: string,
        public readonly projectType: 'qmake' | 'cmake'
    ) {
        super(label, collapsibleState);
        this.contextValue = 'qtProject';
        this.tooltip = projectFile;
        this.description = projectType === 'qmake' ? '(QMake)' : '(CMake)';
        this.iconPath = new vscode.ThemeIcon('project');
    }
}

export class QtActionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        private commandId: string,
        public readonly icon: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.command = {
            title: label,
            command: commandId
        } as vscode.Command;
        this.iconPath = new vscode.ThemeIcon(icon);
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
    
    constructor(
        qtProjectDetector: QtProjectDetector,
        qtConfigManager: QtConfigManager,
        outputChannel: vscode.OutputChannel
    ) {
        this.qtProjectDetector = qtProjectDetector;
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
        
        // Refresh on workspace changes
        vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh());
        
        // Initial load
        this.loadProjects();
    }
    
    /**
     * Load all Qt projects from workspace
     */
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
    
    /**
     * Get tree items
     */
    async getTreeItem(element: vscode.TreeItem): Promise<vscode.TreeItem> {
        return element;
    }
    
    /**
     * Get tree children
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        // Root level - show projects and actions
        if (!element) {
            const children: vscode.TreeItem[] = [];
            
            // Add quick action items at top
            const quickActionsGroup = new vscode.TreeItem(
                'Quick Actions',
                vscode.TreeItemCollapsibleState.Collapsed
            );
            quickActionsGroup.iconPath = new vscode.ThemeIcon('play-circle');
            
            // Add projects
            for (const projectFile of this.projects) {
                const projectInfo = await this.qtProjectDetector.getProjectInfo(projectFile);
                if (projectInfo) {
                    children.push(
                        new QtProjectTreeItem(
                            projectInfo.name,
                            vscode.TreeItemCollapsibleState.Collapsed,
                            projectFile,
                            projectInfo.type
                        )
                    );
                }
            }
            
            // If no projects found, show message
            if (children.length === 0) {
                const noProjectsItem = new vscode.TreeItem(
                    'No Qt projects found'
                );
                noProjectsItem.iconPath = new vscode.ThemeIcon('info');
                return [noProjectsItem];
            }
            
            return children;
        }
        
        // Show commands for a project
        if (element instanceof QtProjectTreeItem) {
            return [
                new QtActionItem('Build', 'qt.buildProject', 'tools'),
                new QtActionItem('Clean', 'qt.cleanProject', 'trash'),
                new QtActionItem('Rebuild', 'qt.rebuildProject', 'refresh'),
                new QtActionItem('Run', 'qt.runProject', 'run')
            ];
        }
        
        return [];
    }
    
    /**
     * Refresh the tree
     */
    async refresh(): Promise<void> {
        await this.loadProjects();
        this._onDidChangeTreeData.fire(undefined);
    }
    
    /**
     * Collapse all items
     */
    collapseAll(): void {
        // VS Code doesn't have a direct API for this, but we can refresh
        this.refresh();
    }
}
