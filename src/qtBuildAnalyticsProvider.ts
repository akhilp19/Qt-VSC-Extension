import * as vscode from 'vscode';
import * as path from 'path';
import { QtBuildAnalytics, PersistedBuildRecord, ProjectAnalytics, FileTimingAggregate } from './qtBuildAnalytics';
import { QtBuildTracker } from './qtBuildTracker';

type AnalyticsNode =
    | { type: 'root' }
    | { type: 'project'; projectFile: string; analytics: ProjectAnalytics }
    | { type: 'stat'; label: string; value: string; icon: string }
    | { type: 'build'; record: PersistedBuildRecord }
    | { type: 'timingGroup'; projectFile: string }
    | { type: 'timing'; file: FileTimingAggregate }
    | { type: 'ccache'; info: { label: string; value: string; icon: string }[] }
    | { type: 'empty'; message: string };

export class QtBuildAnalyticsProvider implements vscode.TreeDataProvider<AnalyticsNode>, vscode.Disposable {
    private buildAnalytics: QtBuildAnalytics;
    private buildTracker: QtBuildTracker;
    private outputChannel: vscode.OutputChannel;
    private _onDidChangeTreeData = new vscode.EventEmitter<AnalyticsNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        buildAnalytics: QtBuildAnalytics,
        buildTracker: QtBuildTracker,
        outputChannel: vscode.OutputChannel
    ) {
        this.buildAnalytics = buildAnalytics;
        this.buildTracker = buildTracker;
        this.outputChannel = outputChannel;

        // Refresh when build tracker updates
        buildTracker.onDidUpdate(() => {
            this.refresh();
        });
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: AnalyticsNode): vscode.TreeItem {
        switch (element.type) {
            case 'root':
                return new vscode.TreeItem('Build Analytics', vscode.TreeItemCollapsibleState.Expanded);

            case 'project': {
                const analytics = element.analytics;
                const item = new vscode.TreeItem(
                    analytics.projectName,
                    vscode.TreeItemCollapsibleState.Expanded
                );
                item.iconPath = new vscode.ThemeIcon(analytics.isRegression ? 'warning' : 'project');
                item.contextValue = 'analyticsProject';
                if (analytics.isRegression && analytics.lastBuild) {
                    const ratio = (analytics.lastBuild.durationMs / analytics.averageDurationMs).toFixed(1);
                    item.tooltip = `⚠ Build regression detected: last build took ${ratio}x longer than average (${QtBuildAnalytics.formatDuration(analytics.lastBuild.durationMs)} vs avg ${QtBuildAnalytics.formatDuration(analytics.averageDurationMs)})`;
                }
                return item;
            }

            case 'stat': {
                const item = new vscode.TreeItem(element.label);
                item.description = element.value;
                item.iconPath = new vscode.ThemeIcon(element.icon);
                item.collapsibleState = vscode.TreeItemCollapsibleState.None;
                return item;
            }

            case 'build': {
                const record = element.record;
                const label = `${record.taskType.charAt(0).toUpperCase() + record.taskType.slice(1)}`;
                const item = new vscode.TreeItem(label);
                item.description = `${QtBuildAnalytics.formatDuration(record.durationMs)} — ${record.success ? 'Success' : 'Failed'} — ${QtBuildAnalytics.formatTimeAgo(record.endTime)}`;
                item.iconPath = new vscode.ThemeIcon(record.success ? 'check' : 'error');
                item.collapsibleState = vscode.TreeItemCollapsibleState.None;
                item.tooltip = [
                    `Type: ${record.taskType}`,
                    `Duration: ${QtBuildAnalytics.formatDuration(record.durationMs)}`,
                    `Result: ${record.success ? 'Success' : 'Failed'}`,
                    `Time: ${new Date(record.endTime).toLocaleString()}`
                ].join('\n');
                return item;
            }

            case 'timingGroup': {
                const item = new vscode.TreeItem('Slowest Files', vscode.TreeItemCollapsibleState.Collapsed);
                item.iconPath = new vscode.ThemeIcon('flame');
                return item;
            }

            case 'timing': {
                const f = element.file;
                const item = new vscode.TreeItem(path.basename(f.filePath));
                item.description = `${QtBuildAnalytics.formatDuration(f.averageDurationMs)} avg / ${QtBuildAnalytics.formatDuration(f.totalDurationMs)} total (${f.occurrenceCount}x)`;
                item.iconPath = new vscode.ThemeIcon('file-code');
                item.collapsibleState = vscode.TreeItemCollapsibleState.None;
                item.tooltip = [
                    f.filePath,
                    `Average: ${QtBuildAnalytics.formatDuration(f.averageDurationMs)}`,
                    `Total: ${QtBuildAnalytics.formatDuration(f.totalDurationMs)}`,
                    `Last: ${QtBuildAnalytics.formatDuration(f.lastDurationMs)}`,
                    `Builds: ${f.occurrenceCount}`
                ].join('\n');
                item.command = {
                    command: 'vscode.open',
                    title: 'Open File',
                    arguments: [vscode.Uri.file(f.filePath)]
                };
                return item;
            }

            case 'ccache': {
                const item = new vscode.TreeItem('Compiler Cache', vscode.TreeItemCollapsibleState.Expanded);
                item.iconPath = new vscode.ThemeIcon('database');
                return item;
            }

            case 'empty': {
                const item = new vscode.TreeItem(element.message);
                item.iconPath = new vscode.ThemeIcon('info');
                item.collapsibleState = vscode.TreeItemCollapsibleState.None;
                return item;
            }
        }
    }

    getChildren(element?: AnalyticsNode): AnalyticsNode[] | Thenable<AnalyticsNode[]> {
        if (!element) {
            // Root level
            const projects = this.buildAnalytics.getAllProjects();
            if (projects.length === 0) {
                return [{ type: 'empty', message: 'No builds yet. Run a Qt build to see analytics.' }];
            }
            return [
                ...projects.map(pf => ({
                    type: 'project' as const,
                    projectFile: pf,
                    analytics: this.buildAnalytics.getProjectAnalytics(pf)
                })),
                { type: 'ccache', info: [] }
            ];
        }

        switch (element.type) {
            case 'project': {
                const a = element.analytics;
                const nodes: AnalyticsNode[] = [];

                if (a.lastBuild) {
                    const isBuilding = this.buildTracker.isBuilding(element.projectFile);
                    nodes.push({
                        type: 'stat',
                        label: 'Last Build',
                        value: isBuilding
                            ? 'In progress...'
                            : `${QtBuildAnalytics.formatTimeAgo(a.lastBuild.endTime)} (${QtBuildAnalytics.formatDuration(a.lastBuild.durationMs)})`,
                        icon: isBuilding ? 'sync~spin' : (a.lastBuild.success ? 'check' : 'error')
                    });
                }

                if (a.totalBuilds > 0) {
                    const rate = Math.round((a.successfulBuilds / a.totalBuilds) * 100);
                    nodes.push({
                        type: 'stat',
                        label: 'Success Rate',
                        value: `${rate}% (${a.successfulBuilds}/${a.totalBuilds})`,
                        icon: rate >= 80 ? 'pass' : (rate >= 50 ? 'warning' : 'error')
                    });
                }

                if (a.averageDurationMs > 0) {
                    nodes.push({
                        type: 'stat',
                        label: 'Average Duration',
                        value: QtBuildAnalytics.formatDuration(a.averageDurationMs),
                        icon: 'clock'
                    });
                }

                // Recent builds (last 5)
                const recent = this.buildAnalytics.getRecords(element.projectFile).slice(0, 5);
                if (recent.length > 0) {
                    nodes.push(...recent.map(r => ({ type: 'build' as const, record: r })));
                }

                // Per-file timing
                const timing = this.buildAnalytics.getPerFileTiming(element.projectFile);
                if (timing.length > 0) {
                    nodes.push({ type: 'timingGroup' as const, projectFile: element.projectFile });
                }

                return nodes;
            }

            case 'timingGroup': {
                const timing = this.buildAnalytics.getPerFileTiming(element.projectFile);
                return timing.slice(0, 10).map(f => ({ type: 'timing' as const, file: f }));
            }

            case 'ccache': {
                return this.getCcacheChildren();
            }

            default:
                return [];
        }
    }

    private async getCcacheChildren(): Promise<AnalyticsNode[]> {
        const ccache = await this.buildAnalytics.detectCcache();
        const sccache = await this.buildAnalytics.detectSccache();
        const info = ccache || sccache;

        if (!info) {
            return [{ type: 'empty', message: 'ccache/sccache not installed' }];
        }

        const total = info.hits + info.misses;
        const hitRate = total > 0 ? Math.round((info.hits / total) * 100) : 0;

        return [
            { type: 'stat', label: 'Tool', value: ccache ? 'ccache' : 'sccache', icon: 'tools' },
            { type: 'stat', label: 'Version', value: info.version, icon: 'versions' },
            { type: 'stat', label: 'Cache Size', value: info.cacheSize, icon: 'database' },
            { type: 'stat', label: 'Hits', value: info.hits.toLocaleString(), icon: 'check' },
            { type: 'stat', label: 'Misses', value: info.misses.toLocaleString(), icon: 'error' },
            { type: 'stat', label: 'Hit Rate', value: `${hitRate}%`, icon: hitRate >= 50 ? 'pass' : 'warning' }
        ];
    }
}
