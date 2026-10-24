import * as vscode from 'vscode';
import { QtBuildAnalytics, PersistedBuildRecord } from './qtBuildAnalytics';
import { QtTelemetry } from './qtTelemetry';
import { buildExitCodes } from './qtBuildTerminal';
import { parseBuildLog } from './qtBuildTimingParser';

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
    private buildAnalytics?: QtBuildAnalytics;
    private telemetry?: QtTelemetry;
    private activeBuilds = new Map<vscode.TaskExecution, BuildRecord>();
    private outcomes = new WeakMap<vscode.TaskExecution, boolean>();
    private disposables: vscode.Disposable[] = [];
    private _onDidUpdate = new vscode.EventEmitter<void>();
    readonly onDidUpdate = this._onDidUpdate.event;

    constructor(outputChannel: vscode.OutputChannel, buildAnalytics?: QtBuildAnalytics, telemetry?: QtTelemetry) {
        this.outputChannel = outputChannel;
        this.buildAnalytics = buildAnalytics;
        this.telemetry = telemetry;
        this.setupTaskListeners();
    }

    private setupTaskListeners(): void {
        this.disposables.push(vscode.tasks.onDidStartTask(e => {
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

            this.activeBuilds.set(e.execution, record);
            this.outputChannel.appendLine(`[BuildTracker] Started ${taskType} for ${projectFile}`);
            this._onDidUpdate.fire();
        }));

        this.disposables.push(vscode.tasks.onDidEndTaskProcess(e => {
            const record = this.activeBuilds.get(e.execution);
            if (record) { record.success = e.exitCode === 0; }
        }));

        this.disposables.push(vscode.tasks.onDidEndTask(e => {
            const task = e.execution.task;
            if (task.definition.type !== 'qt') { return; }

            const projectFile = task.definition.file as string;
            const taskType = task.definition.task as BuildRecord['taskType'];
            if (!projectFile || !taskType) { return; }

            const record = this.activeBuilds.get(e.execution);
            if (record) {
                record.endTime = Date.now();
                const buildId = task.definition.buildId as string | undefined;
                record.success = buildId ? buildExitCodes.get(buildId) === 0 : record.success === true;
                if (buildId) { buildExitCodes.delete(buildId); }
                this.outcomes.set(e.execution, record.success);
                this.activeBuilds.delete(e.execution);
                this.records.push(record);
                this.outputChannel.appendLine(`[BuildTracker] Finished ${taskType} for ${projectFile}`);

                // Persist to analytics
                if (this.buildAnalytics) {
                    const persisted: PersistedBuildRecord = {
                        projectFile: record.projectFile,
                        taskType: record.taskType,
                        startTime: record.startTime,
                        endTime: record.endTime,
                        durationMs: record.endTime - record.startTime,
                        success: record.success
                    };
                    this.buildAnalytics.addRecord(persisted);
                }

                // Telemetry
                if (this.telemetry && record.endTime && record.startTime) {
                    this.telemetry.trackBuild(
                        record.taskType,
                        record.endTime - record.startTime,
                        record.success ?? false
                    );
                }

                // Per-file compilation timing
                const config = vscode.workspace.getConfiguration('qt');
                if (config.get<boolean>('perFileTimingEnabled') !== false) {
                    const buildDir = task.definition.buildDir as string | undefined;
                    const logPath = buildDir ? `${buildDir}/.qt-build-output.log` : undefined;
                    if (buildDir && logPath && this.buildAnalytics) {
                        const perFileRecords = parseBuildLog(logPath, buildDir);
                        if (perFileRecords.length > 0) {
                            this.buildAnalytics.addPerFileTiming(projectFile, record.startTime, perFileRecords);
                            this.outputChannel.appendLine(`[BuildTracker] Parsed per-file timing for ${projectFile}: ${perFileRecords.length} file(s)`);
                        }
                    }
                }

                this._onDidUpdate.fire();
            }
        }));
    }

    getExecutionResult(execution: vscode.TaskExecution): boolean | undefined {
        return this.outcomes.get(execution);
    }

    getLastBuild(projectFile: string): BuildRecord | undefined {
        return this.records
            .filter(r => r.projectFile === projectFile)
            .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))[0];
    }

    isBuilding(projectFile: string): boolean {
        for (const record of this.activeBuilds.values()) {
            if (record.projectFile === projectFile) {
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
        this.disposables.forEach(d => d.dispose());
        this.activeBuilds.clear();
        this._onDidUpdate.dispose();
    }
}
