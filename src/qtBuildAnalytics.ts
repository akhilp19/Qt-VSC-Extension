import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { pathExeLookupCmd, isWindows } from './platformUtils';

export interface PersistedBuildRecord {
    projectFile: string;
    taskType: 'build' | 'clean' | 'rebuild' | 'run';
    startTime: number;
    endTime: number;
    durationMs: number;
    success: boolean;
}

export interface ProjectAnalytics {
    projectFile: string;
    projectName: string;
    totalBuilds: number;
    successfulBuilds: number;
    failedBuilds: number;
    averageDurationMs: number;
    lastBuild?: PersistedBuildRecord;
    isRegression?: boolean;
}

export interface CcacheInfo {
    path: string;
    version: string;
    cacheSize: string;
    hits: number;
    misses: number;
}

const HISTORY_FILE = '.vscode/qt-build-history.json';
const MAX_RECORDS = 500;

export class QtBuildAnalytics {
    private outputChannel: vscode.OutputChannel;
    private records: PersistedBuildRecord[] = [];

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.loadHistory();
    }

    // ========================================================================
    // Persistence
    // ========================================================================

    private getHistoryPath(): string | undefined {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return undefined; }
        return path.join(workspaceFolder.uri.fsPath, HISTORY_FILE);
    }

    private loadHistory(): void {
        const historyPath = this.getHistoryPath();
        if (!historyPath || !fs.existsSync(historyPath)) {
            return;
        }
        try {
            const content = fs.readFileSync(historyPath, 'utf-8');
            this.records = JSON.parse(content) as PersistedBuildRecord[];
            this.outputChannel.appendLine(`[BuildAnalytics] Loaded ${this.records.length} build records`);
        } catch {
            this.records = [];
        }
    }

    private saveHistory(): void {
        const historyPath = this.getHistoryPath();
        if (!historyPath) { return; }
        try {
            const dir = path.dirname(historyPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            // Keep only the most recent MAX_RECORDS
            const toSave = this.records.slice(-MAX_RECORDS);
            fs.writeFileSync(historyPath, JSON.stringify(toSave, null, 2), 'utf-8');
        } catch (error) {
            this.outputChannel.appendLine(`[BuildAnalytics] Failed to save history: ${error}`);
        }
    }

    addRecord(record: PersistedBuildRecord): void {
        this.records.push(record);
        this.saveHistory();
        this.outputChannel.appendLine(`[BuildAnalytics] Recorded ${record.taskType} for ${path.basename(record.projectFile)} (${record.durationMs}ms)`);

        // Proactive ccache suggestion after slow builds
        if (record.taskType === 'build' || record.taskType === 'rebuild') {
            const analytics = this.getProjectAnalytics(record.projectFile);
            const config = vscode.workspace.getConfiguration('qt');
            const useCcache = config.get<boolean>('useCcache') ?? false;
            if (!useCcache && analytics.totalBuilds >= 3 && analytics.lastBuild) {
                const ratio = analytics.lastBuild.durationMs / analytics.averageDurationMs;
                if (ratio > 1.5) {
                    void vscode.window.showInformationMessage(
                        `Build for ${analytics.projectName} took ${ratio.toFixed(1)}x longer than average. Enable ccache?`,
                        'Configure ccache',
                        'Dismiss'
                    ).then(choice => {
                        if (choice === 'Configure ccache') {
                            void vscode.commands.executeCommand('qt.configureCcache');
                        }
                    });
                }
            }
        }
    }

    getRecords(projectFile?: string): PersistedBuildRecord[] {
        const sorted = [...this.records].sort((a, b) => b.endTime - a.endTime);
        if (projectFile) {
            return sorted.filter(r => r.projectFile === projectFile);
        }
        return sorted;
    }

    getProjectAnalytics(projectFile: string): ProjectAnalytics {
        const projectRecords = this.records.filter(r => r.projectFile === projectFile);
        const successful = projectRecords.filter(r => r.success);
        const totalDuration = projectRecords.reduce((sum, r) => sum + r.durationMs, 0);

        const averageDurationMs = projectRecords.length > 0 ? Math.round(totalDuration / projectRecords.length) : 0;
        const lastBuild = projectRecords.length > 0
            ? [...projectRecords].sort((a, b) => b.endTime - a.endTime)[0]
            : undefined;
        const isRegression = lastBuild && projectRecords.length >= 3
            ? lastBuild.durationMs > (averageDurationMs * 1.5)
            : false;

        return {
            projectFile,
            projectName: path.basename(projectFile, path.extname(projectFile)),
            totalBuilds: projectRecords.length,
            successfulBuilds: successful.length,
            failedBuilds: projectRecords.length - successful.length,
            averageDurationMs,
            lastBuild,
            isRegression
        };
    }

    getAllProjects(): string[] {
        return Array.from(new Set(this.records.map(r => r.projectFile)));
    }

    // ========================================================================
    // ccache / sccache Detection
    // ========================================================================

    async detectCcache(): Promise<CcacheInfo | undefined> {
        try {
            const lookupCmd = pathExeLookupCmd('ccache');
            const ccachePath = execSync(lookupCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
            if (!ccachePath || !fs.existsSync(ccachePath)) {
                return undefined;
            }

            const versionOutput = execSync(`"${ccachePath}" --version`, { encoding: 'utf-8' }).split('\n')[0];
            const statsOutput = execSync(`"${ccachePath}" -s`, { encoding: 'utf-8' });

            const cacheSizeMatch = statsOutput.match(/cache size\s+([\d.]+\s*\w+)/i);
            const hitsMatch = statsOutput.match(/cache hit.*\n?.*\n?.*\n?\s*(?:direct|preprocessed)\s+(\d+)/i) || statsOutput.match(/hits:\s*(\d+)/i);
            const missesMatch = statsOutput.match(/misses:\s*(\d+)/i) || statsOutput.match(/cache miss.*\n?.*\n?\s*(\d+)/i);

            return {
                path: ccachePath,
                version: versionOutput.replace('ccache version ', '').trim(),
                cacheSize: cacheSizeMatch ? cacheSizeMatch[1] : 'Unknown',
                hits: hitsMatch ? parseInt(hitsMatch[1], 10) : 0,
                misses: missesMatch ? parseInt(missesMatch[1], 10) : 0
            };
        } catch {
            return undefined;
        }
    }

    async detectSccache(): Promise<CcacheInfo | undefined> {
        try {
            const lookupCmd = pathExeLookupCmd('sccache');
            const sccachePath = execSync(lookupCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
            if (!sccachePath || !fs.existsSync(sccachePath)) {
                return undefined;
            }

            const versionOutput = execSync(`"${sccachePath}" --version`, { encoding: 'utf-8' }).split('\n')[0];
            const statsOutput = execSync(`"${sccachePath}" --show-stats`, { encoding: 'utf-8' });

            const cacheSizeMatch = statsOutput.match(/Cache size\s+([\d.]+\s*\w+)/i);
            const hitsMatch = statsOutput.match(/Cache hits\s+(\d+)/i);
            const missesMatch = statsOutput.match(/Cache misses\s+(\d+)/i);

            return {
                path: sccachePath,
                version: versionOutput.replace('sccache ', '').trim(),
                cacheSize: cacheSizeMatch ? cacheSizeMatch[1] : 'Unknown',
                hits: hitsMatch ? parseInt(hitsMatch[1], 10) : 0,
                misses: missesMatch ? parseInt(missesMatch[1], 10) : 0
            };
        } catch {
            return undefined;
        }
    }

    // ========================================================================
    // ccache Configuration
    // ========================================================================

    async configureCcache(): Promise<void> {
        const ccache = await this.detectCcache();
        const sccache = await this.detectSccache();

        if (!ccache && !sccache) {
            const result = await vscode.window.showInformationMessage(
                'ccache/sccache not found. Install it for faster builds?',
                'Show Install Instructions',
                'Cancel'
            );
            if (result === 'Show Install Instructions') {
                const instructions = isWindows()
                    ? 'Windows: Download from https://ccache.dev/download.html or use Chocolatey: choco install ccache'
                    : process.platform === 'darwin'
                        ? 'macOS: brew install ccache'
                        : 'Linux: sudo apt install ccache  (or pacman -S ccache / yum install ccache)';
                void vscode.window.showInformationMessage(instructions, { modal: true, detail: 'Install ccache' }, 'OK');
            }
            return;
        }

        const options: { label: string; description: string; value: 'ccache' | 'sccache' }[] = [];
        if (ccache) {
            options.push({ label: 'ccache', description: `v${ccache.version} at ${ccache.path}`, value: 'ccache' });
        }
        if (sccache) {
            options.push({ label: 'sccache', description: `v${sccache.version} at ${sccache.path}`, value: 'sccache' });
        }

        const selected = options.length === 1
            ? options[0]
            : await vscode.window.showQuickPick(
                options.map(o => ({ label: o.label, description: o.description, value: o.value })),
                { placeHolder: 'Select compiler cache to use' }
            );

        if (!selected) { return; }

        const config = vscode.workspace.getConfiguration('qt');
        await config.update('useCcache', true, vscode.ConfigurationTarget.Workspace);
        await config.update('ccachePath', selected.value === 'ccache' ? ccache!.path : sccache!.path, vscode.ConfigurationTarget.Workspace);

        void vscode.window.showInformationMessage(
            `${selected.label} configured for Qt builds. Rebuild to see speed improvements.`
        );
        this.outputChannel.appendLine(`[BuildAnalytics] Configured ${selected.label} for builds`);
    }

    async showCcacheStats(): Promise<void> {
        const ccache = await this.detectCcache();
        const sccache = await this.detectSccache();

        if (!ccache && !sccache) {
            void vscode.window.showInformationMessage('ccache/sccache not found. Run "Qt: Configure ccache/sccache" first.');
            return;
        }

        const info = ccache || sccache!;
        const total = info.hits + info.misses;
        const hitRate = total > 0 ? Math.round((info.hits / total) * 100) : 0;

        const message = [
            `${ccache ? 'ccache' : 'sccache'} v${info.version}`,
            `Cache size: ${info.cacheSize}`,
            `Hits: ${info.hits.toLocaleString()}`,
            `Misses: ${info.misses.toLocaleString()}`,
            `Hit rate: ${hitRate}%`
        ].join('\n');

        void vscode.window.showInformationMessage(message, { modal: true, detail: 'Cache Statistics' }, 'OK');
    }

    // ========================================================================
    // Formatting Helpers
    // ========================================================================

    static formatDuration(ms: number): string {
        if (ms < 1000) { return `${ms}ms`; }
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) { return `${seconds}s`; }
        const minutes = Math.floor(seconds / 60);
        const remSeconds = seconds % 60;
        return `${minutes}m ${remSeconds}s`;
    }

    static formatTimeAgo(timestamp: number): string {
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
}
