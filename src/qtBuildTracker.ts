import * as vscode from 'vscode';

export interface BuildRecord {
    projectFile: string;
    taskType: 'build' | 'clean' | 'rebuild' | 'run';
    startTime: number;
    endTime?: number;
    success?: boolean;
}

export class QtBuildTracker {
    private outputChannel: vscode.OutputChannel;
    private records: BuildRecord[] = [];
    private activeBuilds = new Map<string, BuildRecord>();
    private _onDidUpdate = new vscode.EventEmitter<void>();
    readonly onDidUpdate = this._onDidUpdate.event;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.setupTaskListeners();
    }

    private setupTaskListeners(): void {
        vscode.tasks.onDidStartTask(e => {
            const task = e.execution.task;
            if (task.definition.type !== 'qt') { return; }

            const projectFile = task.definition.file as string;
            const taskType = task.definition.task as BuildRecord['taskType'];
            if (!projectFile || !taskType) { return; }

            const record: BuildRecord = {
                projectFile,
                taskType,
                startTime: Date.now()
            };

            this.activeBuilds.set(`${projectFile}:${taskType}`, record);
            this.outputChannel.appendLine(`[BuildTracker] Started ${taskType} for ${projectFile}`);
            this._onDidUpdate.fire();
        });

        vscode.tasks.onDidEndTask(e => {
            const task = e.execution.task;
            if (task.definition.type !== 'qt') { return; }

            const projectFile = task.definition.file as string;
            const taskType = task.definition.task as BuildRecord['taskType'];
            if (!projectFile || !taskType) { return; }

            const key = `${projectFile}:${taskType}`;
            const record = this.activeBuilds.get(key);
            if (record) {
                record.endTime = Date.now();
                // VS Code doesn't give us direct success/failure, assume success if it ended
                record.success = true;
                this.activeBuilds.delete(key);
                this.records.push(record);
                this.outputChannel.appendLine(`[BuildTracker] Finished ${taskType} for ${projectFile}`);
                this._onDidUpdate.fire();
            }
        });
    }

    getLastBuild(projectFile: string): BuildRecord | undefined {
        return this.records
            .filter(r => r.projectFile === projectFile)
            .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))[0];
    }

    isBuilding(projectFile: string): boolean {
        for (const key of this.activeBuilds.keys()) {
            if (key.startsWith(`${projectFile}:`)) {
                return true;
            }
        }
        return false;
    }

    getBuildHistory(projectFile: string): BuildRecord[] {
        return this.records
            .filter(r => r.projectFile === projectFile)
            .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
    }

    formatTimeAgo(timestamp?: number): string {
        if (!timestamp) { return 'Never'; }
        const diff = Date.now() - timestamp;
        const seconds = Math.floor(diff / 1000);
        if (seconds < 60) { return `${seconds}s ago`; }
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) { return `${minutes}m ago`; }
        const hours = Math.floor(minutes / 60);
        if (hours < 24) { return `${hours}h ago`; }
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    dispose(): void {
        this._onDidUpdate.dispose();
    }
}
